import type { Secret, SecretStore } from '@basalt/secrets';
import type { z } from 'zod';

import { readJsonObject, removeFile, writeJsonObject } from './io.js';
import type { JsonObject } from './io.js';
import { schemaAwareMerge } from './merge.js';
import {
  collectStoreNames,
  extractSecrets,
  redactSecrets,
  resolveSecrets,
  scopeRef,
} from './secrets-bridge.js';
import type { ConfigKind, PendingSecretWrite } from './secrets-bridge.js';

/**
 * The secret-aware section repository: everything the config store does to ONE
 * section (main / a model provider / a plugin / a tool / an MCP server) once its schema and file path are
 * known. It sits between the pure filesystem helpers (`io.ts`) and the store,
 * so the store reads as lifecycle + caching and this module owns the delicate
 * validate ↔ seal ↔ persist ↔ prune ordering that keeps plaintext off disk.
 *
 * Every function is schema-driven, so all section kinds share one
 * implementation and cannot drift in how they treat secrets.
 */

/** Merge a patch over a base section value (schema-aware; see `merge.ts`). */
function mergeSection(schema: z.ZodType, base: unknown, patch: unknown): unknown {
  return schemaAwareMerge(schema, base, patch);
}

/** Seal a batch of pending secret writes into the secret store, in order. */
async function sealWrites(
  secrets: SecretStore,
  writes: readonly PendingSecretWrite[],
): Promise<void> {
  for (const write of writes) {
    // Sequential on purpose: a section rarely has many secrets, and serial
    // writes keep the secret store's single JSON file consistent.
    // oxlint-disable-next-line no-await-in-loop -- serialize writes to one store file
    await secrets.set(write.storeName, write.input as string | Secret);
  }
}

/** Delete secrets in `drop` that `keep` no longer references. */
async function pruneOrphans(
  secrets: SecretStore,
  keep: ReadonlySet<string>,
  drop: ReadonlySet<string>,
): Promise<void> {
  for (const name of drop) {
    if (!keep.has(name)) {
      // oxlint-disable-next-line no-await-in-loop -- serialize deletes to one store file
      await secrets.delete(name);
    }
  }
}

/**
 * Seal a section's secrets WITHOUT writing the config file: extract plaintext to
 * markers, seal it, and return the validated marker-form document. Used for the
 * main-config env overlay, whose sealed token must reach the in-memory cache but
 * must never be written back to `main.json`.
 */
async function sealSection(
  secrets: SecretStore,
  schema: z.ZodType,
  kind: ConfigKind,
  name: string | undefined,
  incoming: unknown,
): Promise<JsonObject> {
  const { value, writes } = extractSecrets(schema, scopeRef(kind, name), incoming);
  const validated = schema.parse(value) as JsonObject;
  await sealWrites(secrets, writes);
  return validated;
}

/**
 * Persist a section end-to-end: seal its secrets, write the marker-only document
 * atomically, and prune any secrets the previous version referenced but this one
 * no longer does. Returns the validated stored document for the cache.
 */
async function persistSection(
  secrets: SecretStore,
  schema: z.ZodType,
  kind: ConfigKind,
  name: string | undefined,
  dir: string,
  path: string,
  prior: JsonObject | undefined,
  incoming: unknown,
  uniqueSuffix: string,
): Promise<JsonObject> {
  const validated = await sealSection(secrets, schema, kind, name, incoming);
  await writeJsonObject(dir, path, validated, uniqueSuffix);
  const previous = prior ? collectStoreNames(schema, prior) : new Set<string>();
  await pruneOrphans(secrets, collectStoreNames(schema, validated), previous);
  return validated;
}

/** Read + validate a section file, or `undefined` if it is absent. */
async function readSection(schema: z.ZodType, path: string): Promise<JsonObject | undefined> {
  const raw = await readJsonObject(path);
  return raw === undefined ? undefined : (schema.parse(raw) as JsonObject);
}

/**
 * Write an already-validated document to a section file atomically. Used to seed
 * the base template (which contains no secrets, so no sealing is required).
 */
async function writeSection(
  dir: string,
  path: string,
  value: JsonObject,
  uniqueSuffix: string,
): Promise<void> {
  await writeJsonObject(dir, path, value, uniqueSuffix);
}

/** Delete a section: prune every secret it referenced, then remove the file. */
async function deleteSection(
  secrets: SecretStore,
  schema: z.ZodType,
  path: string,
  prior: JsonObject,
): Promise<void> {
  await pruneOrphans(secrets, new Set(), collectStoreNames(schema, prior));
  await removeFile(path);
}

/** Resolve a stored section's markers to live {@link Secret} boxes. */
function resolveSection(secrets: SecretStore, schema: z.ZodType, stored: JsonObject): unknown {
  return resolveSecrets(schema, stored, (storeName) => secrets.get(storeName));
}

/** A display-safe view of a stored section (secrets shown as `[redacted]`). */
function redactSection(schema: z.ZodType, stored: JsonObject): unknown {
  return redactSecrets(schema, stored);
}

export {
  deleteSection,
  mergeSection,
  persistSection,
  readSection,
  redactSection,
  resolveSection,
  sealSection,
  writeSection,
};
