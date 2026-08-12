import { createHash } from 'node:crypto';

import { isSecret } from '@basalt/secrets';
import type { Secret } from '@basalt/secrets';
import type { z } from 'zod';

import { isSecretRef, makeSecretRef, REDACTED, refOf } from './secret-field.js';
import type { SecretInput } from './secret-field.js';
import { mapSecrets } from './walk.js';
import type { Path } from './walk.js';

/**
 * The bridge between config and `@basalt/secrets` — where "scrub secrets on the
 * way out, resolve them on the way in" actually happens. It never touches the
 * secret store directly; it works purely in terms of markers, refs, and
 * store names, so it stays synchronous and easily testable. The store I/O is
 * the `ConfigStore`'s job (see `store.ts`).
 *
 * Three operations, all schema-guided via the walker so they agree on exactly
 * which fields are secret:
 *
 *  - {@link extractSecrets} — turn a caller's config (plaintext or `Secret` in
 *    the secret fields) into the ON-DISK form (markers only) plus a list of
 *    pending writes the store should seal into `@basalt/secrets`.
 *  - {@link resolveSecrets} — turn the on-disk form into the RETRIEVED form,
 *    swapping each marker for the live `Secret` a lookup returns.
 *  - {@link redactSecrets} — turn the on-disk form into a DISPLAY form, swapping
 *    each marker for the redaction placeholder.
 *
 * Plus {@link collectStoreNames} to enumerate the store entries a value depends
 * on (used to prune orphaned secrets when a section changes or is deleted).
 */

/** The config kinds a secret can belong to (mirrors the store's sections). */
type ConfigKind = 'main' | 'modelProvider' | 'plugin' | 'tool' | 'mcpServer';

/** Delimiter between a section scope and the field path inside a ref. */
const REF_DELIMITER = '#';

/** Prefix for every config-owned secret name in the `@basalt/secrets` store. */
const STORE_NAME_PREFIX = 'cfg-';

/** Hex characters of the ref digest kept in a store name (160 bits). */
const STORE_NAME_HASH_LENGTH = 40;

/**
 * A stable, human-readable scope for a config section:
 *   - `main`
 *   - `model-provider.<name>`
 *   - `plugin.<name>`
 *   - `tool.<name>`
 *   - `mcp-server.<name>`
 * Used as the prefix of every secret ref that section owns.
 */
function scopeRef(kind: ConfigKind, name?: string): string {
  switch (kind) {
    case 'main': {
      return 'main';
    }
    case 'modelProvider': {
      return `model-provider.${name ?? ''}`;
    }
    case 'plugin': {
      return `plugin.${name ?? ''}`;
    }
    case 'tool': {
      return `tool.${name ?? ''}`;
    }
    case 'mcpServer': {
      return `mcp-server.${name ?? ''}`;
    }
  }
}

/**
 * The reference stored inside a secret marker: `<scope>#<dotted.field.path>`.
 * It is descriptive (so a human reading a config file can tell what a marker
 * points at) but is NOT used directly as the store key — see
 * {@link secretStoreName}.
 */
function fieldRef(scope: string, path: Path): string {
  return `${scope}${REF_DELIMITER}${path.join('.')}`;
}

/**
 * Derive the `@basalt/secrets` store name for a ref. The store enforces a strict
 * name allowlist (`^[a-z0-9][a-z0-9-]*$`), which a descriptive ref (dots, `#`,
 * uppercase env names) does not satisfy — so we key by a short, deterministic
 * digest of the ref instead. Same ref → same name (stable across loads);
 * different refs → different names (collision-resistant).
 */
function secretStoreName(ref: string): string {
  const digest = createHash('sha256')
    .update(ref, 'utf8')
    .digest('hex')
    .slice(0, STORE_NAME_HASH_LENGTH);
  return `${STORE_NAME_PREFIX}${digest}`;
}

/** A secret the store must seal: its ref, derived store name, and raw input. */
interface PendingSecretWrite {
  ref: string;
  storeName: string;
  input: SecretInput;
}

/** Result of {@link extractSecrets}: the on-disk value + secrets to seal. */
interface ExtractResult {
  value: unknown;
  writes: PendingSecretWrite[];
}

/**
 * Convert a caller-supplied config `value` into its on-disk form. Every secret
 * FIELD becomes a `{ $secret: ref }` marker; the plaintext/`Secret` that was
 * there is queued in `writes` for the store to seal into `@basalt/secrets`. A
 * field that already holds a marker (e.g. an untouched load being re-saved) is
 * kept as-is and generates no write.
 *
 * The plaintext is never logged, cloned, or returned in `value` — only carried
 * in `writes` for the immediate seal.
 */
function extractSecrets(schema: z.ZodType, scope: string, value: unknown): ExtractResult {
  const writes: PendingSecretWrite[] = [];
  const out = mapSecrets(schema, value, (leaf, path) => {
    const ref = fieldRef(scope, path);
    // Already a marker (an untouched loaded field, or a caller-provided ref):
    // preserve it and seal nothing new. Re-key the marker to this field's ref
    // so a marker cannot smuggle a reference to a different field's secret.
    if (isSecretRef(leaf)) {
      return makeSecretRef(ref);
    }
    // Plaintext string or a Secret box: queue it for sealing, store a marker.
    if (typeof leaf === 'string' || isSecret(leaf)) {
      writes.push({ ref, storeName: secretStoreName(ref), input: leaf });
      return makeSecretRef(ref);
    }
    // Anything else in a secret slot is invalid; leave it for schema validation
    // to reject rather than silently sealing a non-secret.
    return leaf;
  });
  return { value: out, writes };
}

/** Looks up the live {@link Secret} for a derived store name, if present. */
type SecretLookup = (storeName: string) => Secret | undefined;

/**
 * Convert an on-disk config `value` into its retrieved form: each secret marker
 * becomes the live {@link Secret} `lookup` returns for its derived store name,
 * or `undefined` if the store has no such entry (a dangling ref — surfaced as
 * `undefined` rather than throwing, so a partially-configured section still
 * loads).
 */
function resolveSecrets(schema: z.ZodType, value: unknown, lookup: SecretLookup): unknown {
  return mapSecrets(schema, value, (leaf) => {
    if (!isSecretRef(leaf)) {
      return leaf;
    }
    return lookup(secretStoreName(refOf(leaf)));
  });
}

/**
 * Convert an on-disk config `value` into a display form safe to log or print:
 * every secret marker becomes the {@link REDACTED} placeholder. No ref or
 * plaintext survives.
 */
function redactSecrets(schema: z.ZodType, value: unknown): unknown {
  return mapSecrets(schema, value, (leaf) => (isSecretRef(leaf) ? REDACTED : leaf));
}

/**
 * The set of `@basalt/secrets` store names referenced by every marker present
 * in `value`. Used to prune secrets orphaned when a section is rewritten or
 * deleted (any stored name no longer in this set can be removed).
 */
function collectStoreNames(schema: z.ZodType, value: unknown): Set<string> {
  const names = new Set<string>();
  mapSecrets(schema, value, (leaf) => {
    if (isSecretRef(leaf)) {
      names.add(secretStoreName(refOf(leaf)));
    }
    return leaf;
  });
  return names;
}

export {
  collectStoreNames,
  type ConfigKind,
  extractSecrets,
  fieldRef,
  type PendingSecretWrite,
  redactSecrets,
  resolveSecrets,
  scopeRef,
  secretStoreName,
};
