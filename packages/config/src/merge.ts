import { z } from 'zod';

import { isSecretField } from './secret-field.js';
import { unwrapSchema } from './walk.js';

/**
 * Schema-aware deep merge of a `base` config value under an `override`. This is
 * how the config store layers precedence sources (schema defaults < base
 * template < live file < env overlay) into one value before a final validate.
 *
 * The merge is SCHEMA-AWARE for one reason: not every object should deep-merge.
 *
 *  - **Plain objects** (`ZodObject`, and unknown-key sub-objects under a loose
 *    object) deep-merge key-by-key — that is what you want for `gateway`, etc.
 *  - **Discriminated unions, arrays, records, and secret markers REPLACE
 *    wholesale.** Deep-merging them produces invalid hybrids: merging an
 *    `apiKey` auth under an `oauth` auth would leave a stray `apiKey` on the
 *    oauth variant; merging arrays would concat or leave stale trailing
 *    elements; merging records would resurrect a key the override removed;
 *    merging two secret markers is meaningless. For these, the override (when
 *    present) wins entirely.
 *
 * `undefined` on the override side means "not provided — keep base"; any other
 * value (including `null`) is an explicit override. Neither input is mutated.
 */
function schemaAwareMerge(schema: z.ZodType, base: unknown, override: unknown): unknown {
  // Absent side: the other wins outright.
  if (override === undefined) {
    return base;
  }
  if (base === undefined) {
    return override;
  }

  const node = unwrapSchema(schema);

  // A secret field is a branded object (the `{ $secret }` marker), so it would
  // otherwise match the ZodObject branch and deep-merge two markers. Replace it
  // wholesale — a secret is atomic; you never merge one reference into another.
  if (isSecretField(node)) {
    return override;
  }

  // Only genuine (non-discriminated) object schemas deep-merge. Everything else
  // — discriminated unions, arrays, records, tuples, secrets, scalars — is
  // replaced wholesale by the override.
  if (node instanceof z.ZodObject && isPlainObject(base) && isPlainObject(override)) {
    return mergeObject(node, base, override);
  }

  return override;
}

/** Merge two plain objects under a `ZodObject`, recursing per known field. */
function mergeObject(
  node: z.ZodObject,
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const shape = node.def.shape as Record<string, z.ZodType | undefined>;
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override)) {
    const value = override[key];
    // Explicit `undefined` in the override means "keep base" — leave it be.
    if (value !== undefined) {
      const fieldSchema = shape[key];
      // A known key is merged schema-aware; an unknown (loose) key has no schema
      // to guide us, so deep-merge two plain objects, otherwise take override.
      result[key] =
        fieldSchema === undefined
          ? mergeUnknown(base[key], value)
          : schemaAwareMerge(fieldSchema, base[key], value);
    }
  }

  return result;
}

/**
 * Merge a key the schema does not describe (a loose-object extra). Without a
 * schema we cannot tell a plain sub-object from a union/record, so we take the
 * conservative middle ground: deep-merge two plain objects, otherwise replace.
 */
function mergeUnknown(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const key of Object.keys(override)) {
      const value = override[key];
      if (value !== undefined) {
        result[key] = mergeUnknown(base[key], value);
      }
    }
    return result;
  }
  return override;
}

/** `true` for a non-null, non-array object literal. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { schemaAwareMerge };
