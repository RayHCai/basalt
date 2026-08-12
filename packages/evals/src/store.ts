import { chmod, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EvalResultError } from './errors.js';
import type { Env } from './paths.js';
import { resultsDir, runResultFile } from './paths.js';
import type { RunRecord } from './record.js';
import { assertValidRunId } from './run-id.js';

/**
 * The eval-results store: persist and read back {@link RunRecord}s under
 * `<STATE_DIR>/evaluation-results/`. It follows `@basalt/config`'s on-disk
 * discipline — atomic write (temp + rename), owner-only `0600` permissions, and
 * tolerant listing of a missing directory — so a partially-written record is
 * never observed and results are not world-readable.
 */

/** Owner-only permissions for every stored record. */
const RECORD_FILE_MODE = 0o600;

/** The `.json` suffix stripped from stored record file names. */
const JSON_SUFFIX = '.json';

/** Options for the store operations. */
interface StoreOptions {
  /** Environment map (state-dir resolution). Defaults to `process.env`. */
  env?: Env;
}

/**
 * Write a run record atomically to `<STATE_DIR>/evaluation-results/<runId>.json`
 * and return the absolute path. `mkdir -p` the directory, write to a same-dir
 * temp, chmod, then rename over the target — never leaving a partial or briefly
 * world-readable file. Validates the run id first (path-traversal guard).
 */
async function saveRun(record: RunRecord, options: StoreOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  assertValidRunId(record.runId);

  const dir = resultsDir(env);
  const path = runResultFile(record.runId, env);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const tmp = `${path}.${process.pid.toString()}.tmp`;
  const body = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(tmp, body, { mode: RECORD_FILE_MODE });
  await chmod(tmp, RECORD_FILE_MODE);
  await rename(tmp, path);
  return path;
}

/**
 * Read one run record by id. Throws {@link EvalResultError} if the file is
 * missing, unreadable, or not valid JSON (with the underlying error as `cause`).
 * Validates the run id first.
 */
// oxlint-disable-next-line require-await -- async so a thrown assertValidRunId surfaces as a rejection (callers await)
async function loadRun(runId: string, options: StoreOptions = {}): Promise<RunRecord> {
  const env = options.env ?? process.env;
  assertValidRunId(runId);
  const path = runResultFile(runId, env);
  return readRecord(path);
}

/**
 * List the ids of all stored runs, ascending (which — given the timestamped id
 * format — is chronological order). A missing results directory yields `[]`.
 */
async function listRuns(options: StoreOptions = {}): Promise<string[]> {
  const env = options.env ?? process.env;
  const dir = resultsDir(env);
  // oxlint-disable-next-line init-declarations
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new EvalResultError(`Could not list eval results in ${dir}`, { cause: error });
  }
  return entries
    .filter((name) => name.endsWith(JSON_SUFFIX))
    .map((name) => name.slice(0, -JSON_SUFFIX.length))
    .toSorted();
}

/**
 * Load every stored run record, ascending by id. A record that fails to read is
 * a hard error (a corrupt results dir should be surfaced, not silently skipped).
 */
async function loadAllRuns(options: StoreOptions = {}): Promise<RunRecord[]> {
  const env = options.env ?? process.env;
  const ids = await listRuns({ env });
  const dir = resultsDir(env);
  const records = await Promise.all(ids.map((id) => readRecord(join(dir, `${id}${JSON_SUFFIX}`))));
  return records;
}

/** Read + parse + shallow-validate a record file at `path`. */
async function readRecord(path: string): Promise<RunRecord> {
  // oxlint-disable-next-line init-declarations
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new EvalResultError(`Could not read eval result at ${path}`, { cause: error });
  }
  // oxlint-disable-next-line init-declarations
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new EvalResultError(`Malformed eval result (invalid JSON) at ${path}`, { cause: error });
  }
  if (!isRunRecord(parsed)) {
    throw new EvalResultError(`Malformed eval result (unexpected shape) at ${path}`);
  }
  return parsed;
}

/**
 * Structural guard: the parsed value has the run-record shape this version
 * writes. Deliberately shallow — enough to catch a wrong/old file, not a full
 * schema validation (the writer is the only producer).
 */
function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate['version'] === 1 &&
    typeof candidate['runId'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['params'] === 'object' &&
    candidate['params'] !== null &&
    Array.isArray(candidate['results']) &&
    typeof candidate['metrics'] === 'object' &&
    candidate['metrics'] !== null
  );
}

export { isRunRecord, listRuns, loadAllRuns, loadRun, saveRun, type StoreOptions };
