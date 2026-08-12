import { mkdir, stat } from 'node:fs/promises';

import { agentWorkspaceSessionDir, assertValidName } from '@basalt/config';
import type { Env } from '@basalt/config';

/**
 * Create (or retrieve) a spawned session's WORKING DIRECTORY.
 *
 * Each session runs the agent runtime with its own `sessions/<id>/` under the
 * `.agent-workspace/` tree as its current working directory. Relative writes a
 * session makes land here by default — no per-write policy, just a chdir the
 * runtime performs into the returned {@link SessionWorkspace.dir}. Anything
 * specific to one run stays in its own folder; to reach cross-session artifacts
 * an agent must explicitly name a path one level up under `shared/`.
 *
 * `@basalt/config` owns where the workspace lives (see `agentWorkspaceSessionDir`
 * and `BASALT_AGENT_WORKSPACE_DIR`); this package only creates the per-session
 * subdirectory under it. `basalt init` has already created the workspace root and
 * its `shared/` child, but `mkdir -p` here means a session can also be spun up on
 * a not-yet-initialized workspace without a separate ordering guarantee.
 */
interface CreateOptions {
  /** Environment map (workspace-dir resolution). Defaults to `process.env`. */
  env?: Env;
}

/** The result of {@link create}: a session's working directory and whether it was fresh. */
interface SessionWorkspace {
  /** The session id the directory belongs to (echoed back for convenience). */
  id: string;
  /** Absolute path to the session's working directory (`sessions/<id>`). */
  dir: string;
  /** `true` if this call created the directory; `false` if it already existed. */
  created: boolean;
}

/**
 * Create or retrieve the working directory for `sessionId`, returning its
 * absolute path so the runtime can chdir into it before the session's first tool
 * call. Idempotent: an existing directory is left untouched (its files
 * preserved) and reported with `created: false`.
 *
 * `sessionId` is validated with the same guard config applies to section names,
 * so a traversal attempt (`..`, `/`, …) is rejected before any path reaches
 * disk — the returned dir is always inside the `sessions/` subtree.
 */
async function create(sessionId: string, options: CreateOptions = {}): Promise<SessionWorkspace> {
  const env = options.env ?? process.env;
  assertValidName(sessionId);

  const dir = agentWorkspaceSessionDir(sessionId, env);
  const existed = await isDirectory(dir);
  // Owner-only perms, matching the rest of the managed state tree. Recursive so
  // the workspace root + sessions/ parent are established if init has not run.
  await mkdir(dir, { recursive: true, mode: 0o700 });

  return { id: sessionId, dir, created: !existed };
}

/** `true` if `path` exists and is a directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export { create, type CreateOptions, type SessionWorkspace };
