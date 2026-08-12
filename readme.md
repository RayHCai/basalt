Basalt is a small, light-weight CLI harness similar to Claude code.

Features:

- Cron
- Event/web hooks
- Multi-agent/parallel sessions

Here's how you interact with the agent:

- `basalt`
  ...... messages

- `basalt sessions`

1. --list -> shows a list of all active session IDs, who the parent is, etc
2. --watch [ID] -> let's you stream the session (can't interact with it)

- `basalt cron`

1. --list -> shows all cron job IDs, when they are happening, and if there is a session ID attached to one (it's in progress)

- `basalt init`

1. Creates/updates the `STATE_DIR`, then sets up `agent/` (with `tools/`,
   `mcps/`, and `model-providers/`), `config/`, and `secrets/` underneath it,
   plus the `.agent-workspace/` tree (with `shared/`) under `AGENT_WORKSPACE_DIR`
   (defaults to `STATE_DIR`) (idempotent — running twice never destroys existing
   state).

- `basalt evaluate`

1. Runs the RULER evaluation pipeline over the real RULER datasets (the 13
   RULER v1 tasks — needle-in-haystack variants, variable tracking, common/
   frequent-words extraction, SQuAD/HotpotQA — generated once by
   `scripts/generate-ruler-data.sh`, which runs NVIDIA's own generators). It
   loads the selected samples, drives the agent harness per sample (parallel, N
   reps at temp 0, per-task token/turn caps), scores with RULER's own scorers,
   and stores the run under `STATE_DIR/evaluation-results`. Flags:
   `--fraction <f>`, `--lengths 8k,32k,128k`, `--tasks niah_single_1,vt,qa_1`,
   `--max-samples`, `--reps`, `--concurrency`, `--max-input-tokens`,
   `--max-turns`, `--provider`, `--model`, `--no-store`. Defaults to the `dummy`
   provider (a pipeline smoke test — accuracy is ~0 by design). Datasets are
   sized with the `cl100k_base` tokenizer, so absolute lengths are not directly
   comparable to RULER numbers published for another model's tokenizer.
2. `basalt evaluate report` -> renders stored runs: an accuracy-vs-tokens
   scatter across runs plus the per-`(task, length)` metric table.

Here are some project specific details:

1. pnpm + turbo mono-repo
2. commander CLI tool (including coloring)
3. Typescript + oxlint + prettier
4. Vitetest (keep tests next to source files)

AGENTS:

When adding new code, we should write the tests first, then add the logic.

Here's the project structure. Every workspace member is a package under
`packages/*`. Dependencies flow one direction (leaf -> root):

    cli -> runtime -> session-router -> agent-workspace -> agent
                          |               |               |     |
                          +-> storage     +-> config      |     +-> config -> secrets
                                                           |     +-> observability
                                                           +-> config

```
.github/              CI/CD workflows
pre-commit/           git hook scripts
docs/
    AGENTS.md
    CLAUDE.md
    CONTRIBUTING.md

packages/
    cli/              commander-based entry point + coloring; defines the
                      `basalt`, `basalt sessions`, `basalt cron` sub-commands.
                      Thin: parses args and delegates into runtime.

    runtime/          what `basalt` actually invokes. Wires every package's
                      loader together and owns startup. Connects the full path:
                      cli -> runtime -> session-router -> agent-workspace -> agent.
        session-router/  routes a task to a session; session creation, task
                         queueing + dedup.

    agent/            core agent harness + loop.
        loop/            runtime-facing entry: accepts one message/task, owns
                         the current session, reads from the task queue.
        harness/         assembles the loop's dependencies.
        memory/          long-term memory.
        context/         per-session memory.
        model-router/    dynamic model routing.
        tools-handler/   loads/executes tools (tool code lives in the state dir). for tools that require secrets/env vars that we don't want to be exposed to the agent, we need to have tools pass through
                            config (and underneath secrets)
        mcp-handler/     loads MCP servers (MCP configs live in config/storage).

    model-provider/    how we load a model/model-provider/3rd party harness. There are a few different ways to interact with model providers. First, we can have a pure API key. Then, we can have
                        an oAuth call (simple q/a repsonse, input/output). Finally, we can have a full 3rd party harness (e.x codex, claude-cli) call. We need to make note of the different ways to interact with a model-provider here

    agent-workspace/  the per-session working directory an agent run writes into.
                      On spawn `create(sessionId)` makes/returns
                      `.agent-workspace/sessions/<id>/` (the session cwd); at
                      teardown `cleanupSession`/`cleanupShared` remove a session
                      dir or a `shared/` entry. Session-scoped writes stay in the
                      session cwd; cross-session artifacts go one level up under
                      `shared/`. The workspace root lives at
                      `<AGENT_WORKSPACE_DIR>/.agent-workspace/` (config resolves
                      the base via `BASALT_AGENT_WORKSPACE_DIR`, defaulting to
                      STATE_DIR) — a sibling of the platform tree, not a child, so
                      config/secrets are never reachable by a relative write.

    storage/          sqlite storage — sessions, cron registry, config/plugin
                      tracking; defines the access methods over it.

    config/           create + manage typed config (built on storage). Defaults,
                      mutation, and typed retriever methods. Owns the base config
                      (state dir) and per-model-provider sections (oAuth, API
                      key, entry point, ...). Passes through secrets/ for
                      anything sensitive.

    secrets/          load + store secrets safely; never exposed to the agent.
                      config/ routes sensitive values through here.

    observability/    logs, metrics, traces (log storage under the state dir).

    evals/            RULER-based evaluation pipeline, run via `basalt evaluate`.
                      LOADS the real RULER datasets (generated once by
                      `scripts/generate-ruler-data.sh`, git-ignored), stands up
                      its own runtime pinned to a provider, drives the agent
                      harness per sample (parallel, N reps, token/turn caps),
                      scores with RULER's own scorers, stores runs under
                      `STATE_DIR/evaluation-results`, and reports
                      accuracy-vs-tokens + the metric table.
```

### Runtime state directory (`STATE_DIR`).

The STATE_DIR defaults to `<cwd>/.basalt` (so config and agent live in a `.basalt` folder under the current working dir). Override with `BASALT_STATE_DIR`. (TODO: default this to `~/.basalt` instead, so state is per-user rather than per-directory.)

Runtime state does **not** live in the repo — it's rooted at `STATE_DIR`
(defaults to `<cwd>/.basalt`), managed by `config`/`storage`:

```
<STATE_DIR>/
  agent/
    tools/            installed tool code (loaded by tools-handler)
    mcps/             installed MCP servers (loaded by mcp-handler)
    model-providers/  installed model-provider harnesses
  config/             config files (managed by config/)
  secrets/            encrypted secret store + master key (managed by secrets/)
  logs/               log output (managed by observability/)
```

### Agent workspace (`AGENT_WORKSPACE_DIR`).

Separate from the platform tree above: where agent RUNS write files. The base
defaults to `STATE_DIR` and is overridable with `BASALT_AGENT_WORKSPACE_DIR`.
Point it OUTSIDE the platform tree to make `config`/`secrets`/policy a **sibling**
of the workspace rather than an ancestor — then they are never reachable by a
relative write from a session's cwd, regardless of enforcement (the boundary the
later sandbox builds on). Managed by `agent-workspace/`:

```
<AGENT_WORKSPACE_DIR>/.agent-workspace/   workspace root
  shared/             cross-session artifacts (named explicitly, one level up)
  sessions/
    session-123/      one session's cwd (created on spawn, chdir'd into)
    session-abc/
```

`basalt init` creates the workspace root and `shared/`; `sessions/<id>/` dirs are
created per-run by `create(sessionId)` and removed at teardown by
`cleanupSession` / `cleanupShared`.
