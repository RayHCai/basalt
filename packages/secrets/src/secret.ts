import { timingSafeEqual } from 'node:crypto';

/**
 * The placeholder every accidental stringification of a {@link Secret} yields.
 * A grep for real credential material in logs/JSON should only ever find this.
 */
const REDACTED = '[redacted]';

/**
 * Node's custom-inspect symbol. Referenced by its well-known key so this module
 * stays free of a `node:util` import (and works even if `inspect` is absent).
 */
const INSPECT: unique symbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * A guarded container for a sensitive string (token, API key, password, …).
 *
 * The value is held in a private field and is reachable ONLY through
 * {@link Secret.expose}. Every implicit escape hatch is sealed so a secret can
 * never leak by accident:
 *
 * - `String(secret)` / template literals → `[redacted]`
 * - `JSON.stringify(secret)` → `"[redacted]"`
 * - `util.inspect` / `console.log` → `[redacted]`
 * - own enumerable properties → none carry the value
 * - `structuredClone` (worker/`postMessage`) → copies an empty husk
 *
 * Trusted code calls `.expose()` at the exact point of use (e.g. setting an
 * `Authorization` header) and never stores the result. The agent harness is
 * given the `Secret` box, never the exposed value.
 */
class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (typeof value !== 'string') {
      throw new TypeError('Secret value must be a string');
    }
    this.#value = value;
  }

  /** Length of the underlying secret, safe to expose (no content revealed). */
  get length(): number {
    return this.#value.length;
  }

  /**
   * Reveal the raw secret. This is the ONLY method that returns the value —
   * call it at the point of use and do not retain the result. Every call is a
   * deliberate, auditable disclosure.
   */
  expose(): string {
    return this.#value;
  }

  /**
   * Constant-time comparison against another secret or a raw string. Avoids the
   * early-exit timing leak of `===`. Unequal lengths return `false` (after a
   * dummy compare to keep the timing envelope roughly flat).
   */
  equals(other: Secret | string): boolean {
    const otherValue = other instanceof Secret ? other.expose() : other;
    const a = Buffer.from(this.#value, 'utf8');
    const b = Buffer.from(otherValue, 'utf8');
    if (a.length !== b.length) {
      // Compare a to itself so the work done is independent of the mismatch.
      timingSafeEqual(a, a);
      return false;
    }
    return timingSafeEqual(a, b);
  }

  /**
   * Derive a new {@link Secret} by transforming the raw value. The transform
   * runs inside the box; callers never touch the source or the result plaintext
   * (useful for trim/normalize without an intermediate exposed string).
   */
  map(fn: (value: string) => string): Secret {
    return new Secret(fn(this.#value));
  }

  /** @returns the redaction placeholder — never the value. */
  toString(): string {
    return REDACTED;
  }

  /** @returns the redaction placeholder so `JSON.stringify` cannot leak. */
  toJSON(): string {
    return REDACTED;
  }
}

// Redact in `util.inspect` / `console.log` output. Attached to the prototype
// rather than declared as a computed class member so the class stays
// compatible with --isolatedDeclarations (which cannot infer computed names).
Object.defineProperty(Secret.prototype, INSPECT, {
  value(): string {
    return REDACTED;
  },
  enumerable: false,
});

/** Type guard: `true` only for genuine {@link Secret} instances. */
function isSecret(value: unknown): value is Secret {
  return value instanceof Secret;
}

export { isSecret, REDACTED, Secret };
