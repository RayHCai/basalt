/**
 * Process-liveness primitive for the primary-session kill-switch. Storage owns
 * the definition of "live" because the primary row carries the pid and the
 * repository's `claimPrimary` needs to distinguish a live conflict from a stale
 * row left behind by an ungraceful exit.
 *
 * This module knows nothing about sessions — it is a LEAF so that `sessions.ts`
 * can depend on it without an import cycle. The session-level predicate that
 * pairs with it is `isPrimaryLive` in `./sessions.js`.
 */

/**
 * `true` if a process with the given pid exists. Uses signal 0, which performs
 * the error check without actually delivering a signal. `ESRCH` (no such
 * process) means dead; `EPERM` (permission denied) means alive but not ours.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ESRCH') {
      return false;
    }
    // EPERM means the process exists but we lack permission to signal it —
    // still alive from a liveness perspective.
    return true;
  }
}

export { isProcessAlive };
