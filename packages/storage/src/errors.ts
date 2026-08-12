/**
 * Errors `@basalt/storage` raises intentionally. Kept a small taxonomy so a
 * caller can distinguish an expected conflict (a duplicate id) from an unexpected
 * database fault without string-matching messages.
 */

/* oxlint-disable max-classes-per-file -- a small error taxonomy belongs together */

/** Base class for every error `@basalt/storage` raises intentionally. */
class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Thrown by `sessions.create` when a session with the requested id already
 * exists (a UNIQUE/primary-key violation mapped to a typed error). Carries the
 * offending {@link id} for the caller.
 */
class DuplicateSessionError extends StorageError {
  readonly id: string;

  constructor(id: string) {
    super(`A session with id "${id}" already exists`);
    this.name = 'DuplicateSessionError';
    this.id = id;
  }
}

/**
 * Thrown by `sessions.claimPrimary` when a live primary session already exists
 * (its owning process is still running). Carries the existing primary's
 * {@link id} and {@link pid} so the caller can report who holds the lock.
 */
class PrimaryAlreadyClaimedError extends StorageError {
  readonly id: string;
  readonly pid: number;

  constructor(id: string, pid: number) {
    super(`A live primary session already exists (id="${id}", pid=${pid.toString()})`);
    this.name = 'PrimaryAlreadyClaimedError';
    this.id = id;
    this.pid = pid;
  }
}

export { DuplicateSessionError, PrimaryAlreadyClaimedError, StorageError };
