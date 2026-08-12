import { randomUUID } from 'node:crypto';

/**
 * Session-id handling. A session id is a v4 UUID by default (minted by
 * {@link newId}), but {@link assertValidId} also admits a hand-supplied label
 * like `default-session` so a caller that already owns an id can persist it.
 *
 * The allowed shape is a strict allowlist — letters, digits, and hyphens — not a
 * denylist of bad characters, so path-traversal fragments (`..`, `/`, `\`, NUL),
 * whitespace, and pathological lengths can never reach a primary-key value or a
 * listing. This mirrors the guard `@basalt/secrets` / `@basalt/config` apply to
 * their names.
 */
const ID_PATTERN = /^[A-Za-z0-9-]+$/u;

/** Longest permitted session id, to bound row + listing size. */
const MAX_ID_LENGTH = 128;

/** Mint a fresh session id — a v4 UUID. */
function newId(): string {
  return randomUUID();
}

/**
 * Validate a session id, throwing a descriptive error on any violation. Returns
 * the id unchanged so it can be used inline.
 */
function assertValidId(id: string): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('Session id must be a non-empty string');
  }
  if (id.length > MAX_ID_LENGTH) {
    throw new RangeError(`Session id exceeds ${MAX_ID_LENGTH.toString()} characters`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(`Invalid session id "${id}": use letters, digits and hyphens only.`);
  }
  return id;
}

/** Non-throwing predicate form of {@link assertValidId}. */
function isValidId(id: unknown): id is string {
  return (
    typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id)
  );
}

export { assertValidId, isValidId, MAX_ID_LENGTH, newId };
