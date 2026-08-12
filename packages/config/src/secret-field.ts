import type { Secret } from '@basalt/secrets';
import { z } from 'zod';

/**
 * Secret fields in config are the single most delicate part of this package, so
 * their representation is deliberate and lives here in one place.
 *
 * A secret NEVER appears inline in a config file. On disk, a secret-bearing
 * field holds only a MARKER — `{ "$secret": "<ref>" }` — pointing at an entry in
 * the encrypted `@basalt/secrets` store. The plaintext lives only there, sealed.
 *
 * - {@link secret} builds the Zod schema for such a field. It validates the
 *   marker shape (not raw plaintext), is `.brand()`ed so the resolved value type
 *   is type-level distinguishable from a plain `{ $secret: string }` object, and
 *   is `.meta({ secret: true })`-tagged so the schema walker (`walk.ts`) can
 *   locate every secret field regardless of nesting.
 * - {@link ResolveSecrets} maps a stored config type to its RETRIEVED form:
 *   every {@link SecretRef} becomes a {@link Secret} box.
 * - {@link RedactSecrets} maps it to its DISPLAY form: every ref becomes the
 *   redaction placeholder string.
 * - {@link SecretInputs} maps it to its MUTATION form: a secret field accepts a
 *   {@link SecretInput} (plaintext string or a {@link Secret}); the store
 *   extracts and seals it, replacing it with a fresh marker.
 */

/** The reserved key under which a secret reference is stored on disk. */
const SECRET_MARKER_KEY = '$secret';

/** Zod brand tag distinguishing a secret marker from an incidental object. */
const SECRET_BRAND = 'BasaltSecretRef';

/**
 * The on-disk marker schema: a strict object with exactly a non-empty `$secret`
 * string, branded and tagged. `strictObject` so a stray extra key is rejected
 * rather than silently persisted alongside the reference.
 */
const secretRefSchema = z
  .strictObject({ [SECRET_MARKER_KEY]: z.string().min(1) })
  .brand(SECRET_BRAND)
  .meta({ secret: true });

/** A stored secret reference: `{ "$secret": "<ref>" }`, branded for typing. */
type SecretRef = z.infer<typeof secretRefSchema>;

/**
 * Build a schema for a secret-bearing config field. Use it inside a config
 * schema exactly like any other field:
 *
 * ```ts
 * const auth = z.object({ apiKey: secret() });
 * ```
 *
 * The field validates the marker form and is discoverable by the secret walker.
 */
function secret(): typeof secretRefSchema {
  return secretRefSchema;
}

/**
 * `true` if a Zod schema is (or resolves to) a secret field — i.e. carries the
 * `{ secret: true }` metadata {@link secret} attaches. The walker calls this on
 * already-unwrapped schemas, so it accepts the broad core type.
 */
function isSecretField(schema: z.core.$ZodType): boolean {
  const meta = z.globalRegistry.get(schema);
  return meta?.['secret'] === true;
}

/** The literal placeholder used in redacted views (matches `@basalt/secrets`). */
const REDACTED = '[redacted]';

/** Build a secret marker object from a store reference. */
function makeSecretRef(ref: string): SecretRef {
  return { [SECRET_MARKER_KEY]: ref } as SecretRef;
}

/** Runtime guard: `true` if `value` has the secret-marker shape. */
function isSecretRef(value: unknown): value is SecretRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    SECRET_MARKER_KEY in value &&
    typeof (value as Record<string, unknown>)[SECRET_MARKER_KEY] === 'string'
  );
}

/** Read the reference string out of a marker. */
function refOf(marker: SecretRef): string {
  return (marker as { [SECRET_MARKER_KEY]: string })[SECRET_MARKER_KEY];
}

/**
 * What a caller may pass for a secret field when mutating config: raw plaintext
 * (which the store seals) or an already-boxed {@link Secret}.
 */
type SecretInput = string | Secret;

/**
 * Map a stored config type `T` to its RETRIEVED form — every {@link SecretRef}
 * (including inside records and arrays) becomes a live {@link Secret}.
 *
 * The `SecretRef` check is a NAKED (distributive) conditional so that an
 * optional field `apiKey?: SecretRef` — whose type is `SecretRef | undefined` —
 * distributes to `Secret | undefined` rather than falling through to the object
 * branch. The brand on `SecretRef` keeps the check from misfiring on an ordinary
 * `{ $secret: string }` object.
 */
type ResolveSecrets<T> = T extends SecretRef
  ? Secret
  : T extends readonly (infer E)[]
    ? readonly ResolveSecrets<E>[]
    : T extends object
      ? { [K in keyof T]: ResolveSecrets<T[K]> }
      : T;

/**
 * Map a stored config type `T` to its DISPLAY form — every {@link SecretRef}
 * becomes a plain `string` (the redaction placeholder). Safe to log or print.
 */
type RedactSecrets<T> = T extends SecretRef
  ? string
  : T extends readonly (infer E)[]
    ? readonly RedactSecrets<E>[]
    : T extends object
      ? { [K in keyof T]: RedactSecrets<T[K]> }
      : T;

/**
 * Map a stored config type `T` to its MUTATION form — every {@link SecretRef}
 * becomes a {@link SecretInput} the caller supplies as plaintext/`Secret`.
 */
type SecretInputs<T> = T extends SecretRef
  ? SecretInput
  : T extends readonly (infer E)[]
    ? readonly SecretInputs<E>[]
    : T extends object
      ? { [K in keyof T]: SecretInputs<T[K]> }
      : T;

/**
 * Map a stored config type `T` to a PATCH form — the mutation form
 * ({@link SecretInputs}) but DEEP-PARTIAL, so a caller can set just the fields
 * they mean and let schema defaults + the current value fill the rest. The
 * config store merges a patch over the current value before validating.
 *
 * A discriminated-union field (like a model provider's `auth`) is replaced
 * WHOLESALE by the merge, so it must be supplied as a complete variant even
 * though this type would structurally permit a partial one — the schema
 * validates it on write.
 */
type PatchInput<T> = T extends SecretRef
  ? SecretInput
  : T extends readonly (infer E)[]
    ? readonly PatchInput<E>[]
    : T extends object
      ? { [K in keyof T]?: PatchInput<T[K]> }
      : T;

export {
  isSecretField,
  isSecretRef,
  makeSecretRef,
  type PatchInput,
  type RedactSecrets,
  REDACTED,
  refOf,
  type ResolveSecrets,
  SECRET_MARKER_KEY,
  secret,
  type SecretInput,
  type SecretInputs,
  type SecretRef,
};
