# Runtime ↔ agent connection: the primary-session service

A redesign of how `basalt` starts and how a message reaches the agent. Today the
agent runs one-shot, in-process, against a hard-coded session. We split that into
a long-lived **service** (`basalt start`) that owns a persisted **primary
session**, and a **client** (`basalt <message>`) that connects to it. Nothing
here is built yet beyond the pieces called out under "What already exists".

## Motivation

`basalt <message>` today calls `runtime.run({ kind: 'sendMessage', message })`,
which configures config and runs one agent-loop turn against `DEFAULT_SESSION`
(`packages/agent/src/loop/session.ts`) — a constant `{ id: 'default-session',
provider: 'anthropic', model: 'claude-haiku-4-5' }`. There is no running process,
no session lifecycle, and the `@basalt/storage` sessions table — which exists and
is fully tested — is wired into nothing. `basalt sessions --list` reads a shell
`StorageReader` that always returns `[]`.

We want:

- `basalt start` — start the service locally. It creates and persists a **primary
  session** (storing its own `pid` on the row), shows a **live log view** of what
  the agent stack is doing, blocks until the user terminates it, and on
  termination **deletes** the primary session — which also cancels any in-flight
  agent turn, since the running loop polls the row.
- `basalt <message>` (and the REPL) — connect to the running primary session,
  hand it into the agent-workspace and then the agent runtime, and run the turn.

## What already exists (and stays)

- **`@basalt/storage`** — a working SQLite `sessions` repository
  (`create/get/all/has/count/touch/delete`) with a `user_version` migration
  ladder (`schema.ts`). Not yet consumed by anything.
- **`@basalt/agent-workspace`** — `create(sessionId)` returns a per-session cwd
  under `.agent-workspace/sessions/<id>`; `cleanupSession`/`cleanupShared` tear it
  down. Also not yet consumed.
- **`@basalt/observability`** — structured JSONL logs at
  `<STATE_DIR>/logs/basalt.<date>.<n>.log`, already emitted by every package
  (the agent loop logs `agent turn` / `agent turn complete`).
- **`@basalt/runtime`** — the composition root; `run(request)` dispatches a
  discriminated `RuntimeRequest`. `RunOptions` already carries an (unused in
  production) `session` seam.
- **`@basalt/cli`** — commander program, `run()` returns an exit code and never
  throws; a `StorageReader` seam the `sessions`/`cron` commands read through.

## Decisions

Locked in for this design:

1. **Execution model — the client runs the agent.** `basalt <message>` reads the
   primary session record from storage and runs `runtime → agent-workspace →
agent` **in-process** against it. `basalt start` does **not** host an RPC
   server or execute turns; it owns the primary session record and the live log
   view. No IPC transport or wire protocol is introduced. Logs are the shared
   channel: the client's turn logs to the JSONL file, and `basalt start` renders
   them live because it is tailing that file.
2. **Liveness — storage row + PID; deletion is the kill switch.** The primary
   session is a row in the `sessions` table marked `role='primary'`, carrying the
   owning `basalt start` process `pid`. There is no heartbeat and no background
   writes. On graceful shutdown `basalt start` **deletes** the row (frees the
   primary); the running agent loop **polls** the row between steps and aborts if
   it is gone, so killing the service also cancels an in-flight turn. The stored
   `pid` covers the ungraceful case: on read, a row whose `pid` is no longer a live
   process is treated as stale.
3. **Live view — tail the shared JSONL log.** `basalt start` follows
   `<STATE_DIR>/logs/basalt.*.log`, pretty-printing each line. Reuses the existing
   logger; no separate event bus.
4. **Double-start — refuse, exit non-zero.** If a _live_ primary already exists
   (row present and its `pid` is a live process), `basalt start` errors and exits
   non-zero. A _stale_ row (dead pid, from an ungraceful exit) is reclaimed.

## Architecture

```
basalt start (the service, blocks until terminated)
  ├─ claimPrimary(pid)     → sessions row: role='primary', pid=<own pid>
  ├─ log tail loop         → follow <STATE_DIR>/logs/basalt.*.log, pretty-print
  └─ on SIGINT/SIGTERM/exit → releasePrimary(id) (DELETE row), close storage, exit 0

basalt "do X"  (the client, one turn then exits)
  ├─ resolvePrimary()      → live primary Session, or error if none/stale (dead pid)
  ├─ agent-workspace.create(session.id) → chdir into sessions/<id>
  └─ runtime.run({ kind:'sendMessage', message, session })
        └─ agent.start(session, message)   ── logs to JSONL ──▶ seen by `basalt start`
              └─ between steps: getPrimary()==row? → continue, else abort (cancelled)
```

The two processes never talk directly; the sessions row is the rendezvous and the
kill switch, and the JSONL log is the live feed.

## Per-package changes

### `@basalt/storage` — primary role + liveness (migration v2)

Append a v2 migration to `schema.ts` (v1 is shipped and stays byte-for-byte):

```sql
-- v2 — primary-session role. A session may be designated the singleton
-- 'primary' service owner, carrying the owning `basalt start` pid. The partial
-- unique index enforces at-most-one primary.
ALTER TABLE sessions ADD COLUMN role TEXT;   -- NULL | 'primary'
ALTER TABLE sessions ADD COLUMN pid INTEGER; -- owning `basalt start` pid
CREATE UNIQUE INDEX ux_sessions_primary
  ON sessions (role) WHERE role = 'primary';
```

`Session`, `CreateSessionInput`, and `rowToSession` gain `role: 'primary' | null`
and `pid: number | null`. There is no heartbeat column — deletion of the row is
the liveness/kill signal, and the `pid` covers the ungraceful case. New repository
methods (synchronous, matching the existing prepared-statement style):

- `claimPrimary(pid: number): Session` — insert a row with `role='primary'` and the
  pid. Maps the partial-unique violation to a new `PrimaryAlreadyClaimedError`.
- `getPrimary(): Session | undefined` — the `role='primary'` row, if any.
- `releasePrimary(id: string): boolean` — delete the primary row (frees it). This
  is what `basalt start` calls on shutdown; the deletion is observed by the
  polling agent loop as a cancel.

Liveness helper (storage owns the definition of "live"). Because there is no
heartbeat, "live" is purely: the row exists and its pid is a live process.

```ts
function isProcessAlive(pid: number): boolean; // process.kill(pid, 0), ESRCH → false
function isPrimaryLive(s: Session): boolean; // s.role==='primary' && s.pid!=null && isProcessAlive(s.pid)
```

New error `PrimaryAlreadyClaimedError` alongside `DuplicateSessionError` in
`errors.ts`, exported from the package index.

Reclaiming a stale primary is a repository concern too: `claimPrimary` first
checks `getPrimary()`; if present but not live (dead pid), it deletes that row
before inserting. If present and live, it throws `PrimaryAlreadyClaimedError`.

### `@basalt/config` — `storageDir()`

Storage needs a home, and config owns state-dir resolution (same contract as
`secretsDir`). Add to `paths.ts` and export from the index:

```ts
const STORAGE_DIR_NAME = 'storage';
function storageDir(env: Env = process.env): string {
  return join(stateDir(env), STORAGE_DIR_NAME); // <STATE_DIR>/storage
}
```

The sessions DB is then `<STATE_DIR>/storage/basalt.db` (via storage's `dbFile`).
`basalt init` should `mkdir -p` this alongside the other state dirs.

### `@basalt/runtime` — session in the request + a service composition root

The runtime is the composition root, so the storage/workspace wiring lives here,
not in the CLI.

- `SendMessageRequest` gains `session?: Session`. `sendMessage` passes
  `request.session ?? options.session ?? DEFAULT_SESSION` to `agent.start`. This
  reuses the existing `RunOptions.session` seam; `DEFAULT_SESSION` remains the
  bring-up fallback so nothing regresses before `basalt start` exists.
- New exported service functions (new `service.ts`):

  ```ts
  interface PrimaryService {
    session: Session; // the claimed primary, as an agent Session
    release(): void; // releasePrimary (DELETE row) + close storage
  }
  // Open storage, configureConfig(), claim the primary (reclaiming a stale one),
  // return the handle. Throws PrimaryAlreadyClaimedError on a live conflict.
  function startPrimary(opts?: { pid?: number }): Promise<PrimaryService>;

  // Open storage, return the live primary as an agent Session, or throw
  // NoPrimarySessionError / StalePrimarySessionError.
  function resolvePrimary(): Promise<Session>;
  ```

  Both call `createStorageStore({ dir: storageDir() })`. The storage `Session`
  (id + role/pid) is adapted to the agent `Session` (id + provider + model);
  provider/model come from config's default until per-session model selection
  exists — for now, the `DEFAULT_SESSION` provider/model with the primary's real
  id.

- **Cancellation via row polling.** The client-run turn checks the primary is
  still present between steps and aborts if it has been deleted (i.e. `basalt
start` was terminated). Concretely, `sendMessage` passes a `stillPrimary()`
  predicate (backed by `getPrimary()` returning the same id) down to
  `agent.start`; the loop calls it at each turn boundary and throws a
  `SessionCancelledError` when it returns false. This is why deleting the row is a
  kill switch, not just a free — an in-flight turn observes the deletion. (The
  agent loop today runs a single turn, so the initial cut checks once before the
  provider call; the seam is where multi-turn/tool loops will poll each step.)
- New `RuntimeError` subclasses `NoPrimarySessionError`,
  `StalePrimarySessionError`, and `SessionCancelledError` in `errors.ts`, exported
  from the index. The CLI maps them to exit codes (see below).

### `@basalt/agent-workspace` — used on the client path

No code change; it's finally consumed. The client (via runtime or CLI — see the
open question) calls `create(session.id)` and `process.chdir(dir)` before the
turn, so the agent's relative writes land in `sessions/<primary-id>/`. `basalt
start` owns no workspace (it runs no agent).

### `@basalt/cli` — the `start` command, primary-backed root, real StorageReader

**New `basalt start` command** (`commands/start.ts`, registered in `program.ts`):

1. `const service = await runtime.startPrimary({ pid: process.pid })` — on
   `PrimaryAlreadyClaimedError`, render a terse error and exit non-zero.
2. Print a themed "service running" banner (session id, pid).
3. Start the **log tail**, racing a termination promise: follow the newest
   `<STATE_DIR>/logs/basalt.*.log` — open, seek to end, then on `fs.watch` change
   read the appended bytes, split JSONL, and pretty-print each record
   (`[HH:MM:SS] <pkg> <msg> k=v …`) through the palette. Handle pino-roll rotation
   by re-resolving the newest file when the current one stops growing / a newer one
   appears. (No heartbeat loop — the service does no periodic writes.)
4. Install SIGINT/SIGTERM handlers that resolve the termination promise. A
   `finally` stops the watcher and calls `service.release()` (delete primary row +
   close storage). Deleting the row is what cancels any in-flight client turn. The
   command's promise resolves only on termination, so `run()`'s exit-code contract
   is preserved (it returns `ok`).

**`runRoot` / REPL** (`commands/root.ts`): before sending, resolve the primary via
a new context seam `ctx.resolvePrimary()`. If it throws `NoPrimarySessionError` /
`StalePrimarySessionError`, surface a terse line: _"No primary session — run
`basalt start` first."_ Otherwise pass the resolved `Session` into
`ctx.run({ kind: 'sendMessage', message, session })`. The REPL resolves once at
entry and reuses it for the loop.

**Context** (`context.ts`): add `resolvePrimary` (defaults to runtime's) and a
`startPrimary` seam for the `start` command, both injectable for tests.

**Real `StorageReader`** (`storage.ts`): replace the shell with one backed by
`createStorageStore({ dir: storageDir() })`, mapping storage `Session` →
`SessionInfo` (`role==='primary'` and live → `status:'running'`; the `task`/
`parentId` fields default until the schema carries them). `basalt sessions
--list` then shows the live primary. The domain types in `domain.ts` can migrate
into storage later; for this change the mapping is enough.

**Errors** (`errors.ts`): map `NoPrimarySessionError` / `StalePrimarySessionError`
to a terse non-zero exit (a usage-ish `unavailable` code — 69, or reuse
`failure`/1), and `PrimaryAlreadyClaimedError` and `SessionCancelledError`
likewise (a client turn that was cancelled mid-flight because `basalt start` was
terminated reports a terse "session cancelled" line). All are expected, terse
failures — not crashes.

## Log-tail rendering

Each JSONL line is `{ level, time, name, msg, ...bindings }`. Render as:

```
[12:00:01] agent  turn          session=primary-abc provider=anthropic
[12:00:02] mp     provider call model=claude-haiku-4-5
[12:00:03] agent  turn complete session=primary-abc
```

`name` is the `basalt.<pkg>` subsystem (strip the prefix); level colors come from
the palette; extra bindings render as `k=v`. Malformed lines are skipped rather
than crashing the view.

## Lifecycle & edge cases

- **Clean shutdown** — SIGINT/SIGTERM → delete the primary row → exit 0. A
  subsequent `basalt <message>` sees no primary and errors clearly.
- **Shutdown mid-turn** — deleting the row while a client turn is running is
  observed by the loop's poll → the turn aborts with `SessionCancelledError`.
- **Crash / kill -9** — the row is left behind but its pid is dead, so
  `isPrimaryLive` is false. The client reports a stale primary; the next `basalt
start` reclaims it (deletes the stale row, claims fresh).
- **Two `basalt start`** — the second's `claimPrimary` hits the live check and
  throws `PrimaryAlreadyClaimedError` → non-zero exit.
- **Client during startup race** — the partial-unique index makes `claimPrimary`
  atomic; only one primary can exist at a time regardless of interleaving.
- **`basalt <message>` with no `basalt start`** — `resolvePrimary` throws
  `NoPrimarySessionError`; terse guidance to run `basalt start`.

## Testing

- **storage** — v2 migration applies on a v1 DB; `claimPrimary` enforces
  at-most-one; stale reclaim path (dead pid); `isPrimaryLive` with a live vs. dead
  pid (inject the `isProcessAlive` probe); `releasePrimary` frees the slot.
- **runtime** — `startPrimary`/`resolvePrimary` over an in-memory
  (`:memory:`) store and injected config; error taxonomy; `sendMessage` honors an
  injected session; the `stillPrimary()` poll aborts with `SessionCancelledError`
  when the row is deleted mid-turn.
- **cli** — `start` claims, tails a temp log file, and deletes the row on a
  simulated signal (injected seams, no real process); `runRoot` errors without a
  primary and dispatches with the resolved session; `StorageReader` maps a primary
  row to `status:'running'`. Existing `run()`-returns-exit-code tests still hold.

## Sequencing

1. storage v2 (migration + methods + errors + liveness) — leaf, no dependents.
2. config `storageDir()`.
3. runtime `service.ts` + session-in-request + errors.
4. cli `start` command, primary-backed root, real `StorageReader`, error mapping.
5. Build each package (Node 24 ESM / `tsc -b` / vitest per the package build
   notes) and verify the flow end-to-end: `basalt start` in one shell shows the
   live view; `basalt "hi"` in another runs a turn whose logs appear in the first;
   Ctrl-C frees the primary; a follow-up `basalt "hi"` errors cleanly.

## Open questions

- **Who does the workspace chdir + turn — runtime or CLI?** Cleanest is the
  runtime `sendMessage` calling `agent-workspace.create(session.id)` + chdir, so
  the CLI stays a thin client and the composition root owns all wiring. Downside:
  `runtime` takes an `@basalt/agent-workspace` dependency. Alternative: the CLI
  does the chdir before calling `run`. Leaning runtime-owns-it.
- **`SessionInfo` migration** — move the CLI's `domain.ts` shapes into
  `@basalt/storage` now, or keep the CLI-side mapping until the schema grows
  `task`/`parentId`? This design assumes the latter (smaller delta).
- **provider/model per session** — the primary session currently inherits
  `DEFAULT_SESSION`'s provider/model. Real per-session model selection is out of
  scope here and noted for later.

```

```
