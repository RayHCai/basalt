/**
 * `@basalt/agent-workspace` — the working-directory layer for spawned agent runs.
 *
 * The workspace is where agent RUNS write files, kept structurally apart from the
 * platform tree (`config/`, `secrets/`, installed agent code) that `@basalt/config`
 * owns. Its root is `<AGENT_WORKSPACE_DIR>/.agent-workspace/` (config resolves the
 * base; see `BASALT_AGENT_WORKSPACE_DIR`, which defaults to the state dir):
 *
 * ```
 * <AGENT_WORKSPACE_DIR>/.agent-workspace/
 *   shared/                cross-session artifacts (an agent names a path here explicitly)
 *   sessions/
 *     session-123/         one session's cwd
 *     session-abc/
 * ```
 *
 * The model is a chdir, not a policy: each spawned session runs with its own
 * `sessions/<id>/` as the current working directory, so a run's relative writes
 * land inside its own folder by default and reaching `shared/` (one level up)
 * takes an explicit path. Because the workspace can be relocated OUTSIDE the
 * platform tree, config/policy/secrets are never reachable by a relative write —
 * a clean structural boundary the later sandbox enforcement builds on.
 *
 * The runtime calls {@link create} on spawn to get (and chdir into) a session's
 * cwd, and {@link cleanupSession} / {@link cleanupShared} at teardown. Both
 * cleanup calls are the seam a retention rule (archive / retain / GC) grows into
 * later; today they hard-delete.
 *
 * ```ts
 * import { create, cleanupSession } from '@basalt/agent-workspace';
 *
 * const { dir } = await create('session-123'); // sessions/session-123, mkdir -p
 * process.chdir(dir);                           // relative writes now land here
 * // …run the agent…
 * await cleanupSession('session-123');          // teardown
 * ```
 */

export { create, type CreateOptions, type SessionWorkspace } from './create.js';
export { cleanupSession, cleanupShared, type CleanupOptions } from './cleanup.js';
