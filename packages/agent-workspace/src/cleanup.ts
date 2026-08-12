import { rm, stat } from 'node:fs/promises';

import {
  agentWorkspaceSessionDir,
  agentWorkspaceSharedEntryDir,
  assertValidName,
} from '@basalt/config';
import type { Env } from '@basalt/config';

/**
 * Workspace TEARDOWN — the seam a session's end runs through.
 *
 * Today teardown is a hard delete: {@link cleanupSession} removes a session's
 * working directory, {@link cleanupShared} removes a named entry under `shared/`.
 * This is deliberately the whole retention policy for now — the point is that the
 * teardown seam LIVES HERE, so a later archive / retain / GC rule (e.g. tar a
 * finished session off before deletion, keep the last N, sweep on a timer) has
 * one place to grow into without callers changing. Both are idempotent and
 * tolerate an absent target, so a double-teardown or a never-started session is a
 * no-op, not an error.
 */
interface CleanupOptions {
  /** Environment map (workspace-dir resolution). Defaults to `process.env`. */
  env?: Env;
}

/**
 * Remove a session's working directory and everything under it. Returns `true`
 * if a directory was removed, `false` if it did not exist. `sessionId` is
 * validated with the same guard as {@link create}, so a traversal attempt is
 * rejected before any path reaches disk.
 */
// oxlint-disable-next-line require-await -- async so a name-validation failure rejects rather than throwing synchronously (matches the config store + the tests' .rejects)
async function cleanupSession(sessionId: string, options: CleanupOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  assertValidName(sessionId);
  return removeTree(agentWorkspaceSessionDir(sessionId, env));
}

/**
 * Remove a named entry (file or directory) directly under `shared/`, and
 * everything under it. Cross-session artifacts are explicit — the caller names
 * the entry one level up under `shared/`, never a bare session id. Returns `true`
 * if something was removed, `false` if the entry did not exist. `name` is
 * validated the same way as a session id, so it cannot escape the `shared/`
 * subtree.
 */
// oxlint-disable-next-line require-await -- async so a name-validation failure rejects rather than throwing synchronously (matches the config store + the tests' .rejects)
async function cleanupShared(name: string, options: CleanupOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  assertValidName(name);
  return removeTree(agentWorkspaceSharedEntryDir(name, env));
}

/**
 * `rm -rf` a path, reporting whether it existed first. The existence check and
 * removal are separate calls, so a concurrent deletion between them just yields
 * `false` (via `force: true` swallowing a now-absent target) rather than
 * throwing — the desired idempotent behavior.
 */
async function removeTree(path: string): Promise<boolean> {
  const existed = await pathExists(path);
  await rm(path, { recursive: true, force: true });
  return existed;
}

/** `true` if `path` exists (of any kind). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export { cleanupSession, cleanupShared, type CleanupOptions };
