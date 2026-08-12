/**
 * Errors raised by the runtime. The runtime is the layer `basalt` actually
 * invokes (`cli → runtime → session-router → agent-workspace → agent`); today it
 * is a shell, so operations with real behavior throw {@link NotImplementedError}.
 *
 * These deliberately do NOT carry process exit codes — mapping a failure to an
 * exit code is the CLI's concern. The CLI recognizes these types and renders
 * them accordingly.
 */

/* oxlint-disable max-classes-per-file -- a small error taxonomy belongs together */

/** Base class for every error the runtime raises intentionally. */
class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/**
 * A runtime operation that is wired but not yet backed by a real
 * implementation. The runtime is currently a shell over the (unbuilt) agent
 * stack; read operations return empty results, while operations with side
 * effects throw this.
 */
class NotImplementedError extends RuntimeError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/**
 * No primary session exists — `basalt start` has not been run (or was killed
 * ungracefully and the stale row was cleaned up).
 */
class NoPrimarySessionError extends RuntimeError {
  constructor() {
    super('No primary session — run `basalt start` first.');
    this.name = 'NoPrimarySessionError';
  }
}

/**
 * A primary session row exists but its owning process is dead. The row is stale
 * from an ungraceful exit; `basalt start` will reclaim it on its next run.
 */
class StalePrimarySessionError extends RuntimeError {
  readonly pid: number;

  constructor(pid: number) {
    super(
      `Primary session is stale (process ${pid.toString()} is dead) — run \`basalt start\` to reclaim.`,
    );
    this.name = 'StalePrimarySessionError';
    this.pid = pid;
  }
}

/**
 * An in-flight agent turn was cancelled because the primary session row was
 * deleted (i.e. `basalt start` was terminated while the client was running).
 */
class SessionCancelledError extends RuntimeError {
  constructor() {
    super('Session cancelled — the primary session was terminated.');
    this.name = 'SessionCancelledError';
  }
}

export {
  NoPrimarySessionError,
  NotImplementedError,
  RuntimeError,
  SessionCancelledError,
  StalePrimarySessionError,
};
