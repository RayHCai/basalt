import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

/**
 * Filesystem helpers for the config store: JSON read/write with the same
 * atomic, owner-only-permission discipline `@basalt/secrets` uses, plus a
 * tolerant section-directory listing. Kept apart from the store so the store
 * reads as orchestration, not I/O plumbing.
 */

/** Owner-only permissions for every config file written. */
const CONFIG_FILE_MODE = 0o600;

/** A JSON object read from (or written to) a config file. */
type JsonObject = Record<string, unknown>;

/** The `.json` suffix stripped from section file names. */
const JSON_SUFFIX = '.json';

/** Read + JSON-parse a config file, returning `undefined` if it does not exist. */
async function readJsonObject(path: string): Promise<JsonObject | undefined> {
  // oxlint-disable-next-line init-declarations
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Malformed config file (expected a JSON object): ${path}`);
  }
  return parsed as JsonObject;
}

/**
 * Write JSON atomically with `0600` perms: `mkdir -p` the directory, write to a
 * same-dir unique temp, chmod, then rename over the target. Never leaves a
 * partial or briefly world-readable file. `uniqueSuffix` must be unique per
 * concurrent writer in this process (the store passes a monotonic counter).
 */
async function writeJsonObject(
  dir: string,
  path: string,
  value: unknown,
  uniqueSuffix: string,
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${uniqueSuffix}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, body, { mode: CONFIG_FILE_MODE });
  await chmod(tmp, CONFIG_FILE_MODE);
  await rename(tmp, path);
}

/**
 * List the section names (`<name>.json` → `<name>`) in a section directory,
 * tolerating an absent directory (returns `[]`).
 */
async function listSectionNames(dir: string): Promise<string[]> {
  // oxlint-disable-next-line init-declarations
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries
    .filter((name) => name.endsWith(JSON_SUFFIX))
    .map((name) => name.slice(0, -JSON_SUFFIX.length));
}

/** Remove a file, tolerating its absence. */
async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export { type JsonObject, listSectionNames, readJsonObject, removeFile, writeJsonObject };
