import { z } from 'zod';

import { isSecretField } from './secret-field.js';

/**
 * Schema-guided walker over a config VALUE. Given a Zod schema and a concrete
 * (already-validated) value, it visits each leaf the schema describes and lets
 * the caller act on the secret-tagged ones. It powers three operations in the
 * secrets bridge — collecting secret paths, extracting plaintext into markers,
 * and resolving/redacting markers — from one traversal so they cannot drift.
 *
 * Design points that make it correct rather than merely convenient:
 *
 * - It follows the schema, not the value, so it only ever treats a field as a
 *   secret when the SCHEMA says so — an attacker-supplied `{ $secret: ... }` in
 *   a plain string field is just data, never dereferenced.
 * - For a discriminated union it descends into the ONE branch the value's
 *   discriminant selects; a value matching no branch is left untouched
 *   (fail-closed — better to skip than to mislabel an unknown shape).
 * - For `looseObject`, keys the schema does not describe are left alone (their
 *   owner registers a schema to have them handled); known keys are walked.
 * - Records and arrays are walked per present entry, so paths mirror the value.
 *
 * Schema nodes are narrowed via `instanceof` against Zod's public classes,
 * which gives typed access to `.def` — rather than casting the untyped
 * `$ZodTypeDef`.
 */

/** A path segment into a config value: an object key or an array index. */
type PathSegment = string | number;

/** A full path from the document root to a leaf. */
type Path = readonly PathSegment[];

/**
 * Strip modifier wrappers (`optional`, `default`, `nullable`, …) and resolve
 * `lazy` to the underlying schema the walker should reason about. Each iteration
 * peels exactly one layer; the loop is bounded by schema nesting depth.
 */
function unwrapSchema(schema: z.ZodType): z.ZodType {
  let current = schema;
  // Each pass peels at most one layer; stop once nothing peels (bounded by
  // schema nesting depth).
  for (let next = peelOnce(current); next !== undefined; next = peelOnce(current)) {
    current = next;
  }
  return current;
}

/** Peel a single wrapper/lazy layer off `schema`, or `undefined` if it is none. */
function peelOnce(schema: z.ZodType): z.ZodType | undefined {
  if (schema instanceof z.ZodLazy) {
    return schema.def.getter() as z.ZodType;
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional
  ) {
    return schema.def.innerType as z.ZodType;
  }
  return undefined;
}

/**
 * The discriminant literal(s) a discriminated-union option pins its
 * discriminator field to. Zod stores literal values as an array.
 */
function optionDiscriminatorValues(option: z.ZodType, discriminator: string): readonly unknown[] {
  const unwrapped = unwrapSchema(option);
  if (!(unwrapped instanceof z.ZodObject)) {
    return [];
  }
  const field = (unwrapped.def.shape as Record<string, z.ZodType | undefined>)[discriminator];
  if (field === undefined) {
    return [];
  }
  const literal = unwrapSchema(field);
  return literal instanceof z.ZodLiteral ? literal.def.values : [];
}

/**
 * Pick the discriminated-union option matching `value`'s discriminant, or
 * `undefined` if the value matches none (an unclassifiable shape).
 */
function selectUnionOption(union: z.ZodDiscriminatedUnion, value: unknown): z.ZodType | undefined {
  const { discriminator } = union.def;
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const discriminant = (value as Record<string, unknown>)[discriminator];
  for (const option of union.def.options as readonly z.ZodType[]) {
    if (optionDiscriminatorValues(option, discriminator).includes(discriminant)) {
      return option;
    }
  }
  return undefined;
}

/** What a visitor is told about a secret leaf, and what it returns to replace it. */
type SecretVisitor = (value: unknown, path: Path) => unknown;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Core recursion. Walks `schema`/`value` in lockstep, invoking `visit` for each
 * secret-tagged leaf and substituting its return value. Non-secret leaves and
 * unrecognized shapes are returned unchanged. Never mutates the input; builds a
 * structurally-shared copy only along paths that actually change.
 */
function transform(schema: z.ZodType, value: unknown, path: Path, visit: SecretVisitor): unknown {
  const node = unwrapSchema(schema);

  // A secret field: hand the leaf to the visitor regardless of its inner shape.
  if (isSecretField(node)) {
    return visit(value, path);
  }

  if (node instanceof z.ZodObject) {
    if (!isRecordValue(value)) {
      return value;
    }
    const shape = node.def.shape as Record<string, z.ZodType>;
    const result: Record<string, unknown> = { ...value };
    let changed = false;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      // Only walk keys actually present in the value (optional fields may be
      // absent); a schema field with no value contributes nothing.
      if (Object.hasOwn(value, key)) {
        const next = transform(fieldSchema, value[key], [...path, key], visit);
        if (next !== value[key]) {
          result[key] = next;
          changed = true;
        }
      }
    }
    return changed ? result : value;
  }

  if (node instanceof z.ZodDiscriminatedUnion) {
    const option = selectUnionOption(node, value);
    // Unclassifiable value (no matching branch): leave it untouched.
    return option === undefined ? value : transform(option, value, path, visit);
  }

  if (node instanceof z.ZodRecord) {
    if (!isRecordValue(value)) {
      return value;
    }
    const valueType = node.def.valueType as z.ZodType;
    const result: Record<string, unknown> = { ...value };
    let changed = false;
    for (const [key, entry] of Object.entries(value)) {
      const next = transform(valueType, entry, [...path, key], visit);
      if (next !== entry) {
        result[key] = next;
        changed = true;
      }
    }
    return changed ? result : value;
  }

  if (node instanceof z.ZodArray) {
    if (!Array.isArray(value)) {
      return value;
    }
    const element = node.def.element as z.ZodType;
    let changed = false;
    const result = value.map((entry: unknown, index) => {
      const next = transform(element, entry, [...path, index], visit);
      if (next !== entry) {
        changed = true;
      }
      return next;
    });
    return changed ? result : value;
  }

  if (node instanceof z.ZodTuple) {
    if (!Array.isArray(value)) {
      return value;
    }
    const items = node.def.items as readonly z.ZodType[];
    let changed = false;
    const result = value.map((entry: unknown, index) => {
      const itemSchema = items[index];
      if (itemSchema === undefined) {
        return entry;
      }
      const next = transform(itemSchema, entry, [...path, index], visit);
      if (next !== entry) {
        changed = true;
      }
      return next;
    });
    return changed ? result : value;
  }

  // Scalars and any container we don't special-case: nothing to descend.
  return value;
}

/**
 * Collect the path to every secret-tagged leaf present in `value`, in
 * document order. Purely observational — the value is not modified.
 */
function collectSecretPaths(schema: z.ZodType, value: unknown): Path[] {
  const paths: Path[] = [];
  transform(schema, value, [], (leaf, path) => {
    paths.push(path);
    return leaf;
  });
  return paths;
}

/**
 * Produce a structural copy of `value` with every secret leaf replaced by
 * `visit(leaf, path)`. Non-secret data is shared with the input; the input is
 * never mutated.
 */
function mapSecrets(schema: z.ZodType, value: unknown, visit: SecretVisitor): unknown {
  return transform(schema, value, [], visit);
}

export { collectSecretPaths, mapSecrets, type Path, unwrapSchema };
