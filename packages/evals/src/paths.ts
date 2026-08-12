import { join } from 'node:path';

import { stateDir } from '@basalt/config';
import type { Env } from '@basalt/config';

/**
 * Where eval artifacts live on disk. All eval state is rooted under
 * `<STATE_DIR>/evals/`, alongside config, secrets, and logs — state-dir
 * resolution is owned by `@basalt/config` (this package imports {@link stateDir}
 * so it reads the exact same location, honoring `BASALT_STATE_DIR`).
 *
 * Layout:
 * ```
 * <STATE_DIR>/evals/
 *   data/                              RULER datasets, populated by
 *     <nominalLength>/<task>/            `basalt evaluate load`
 *       validation.jsonl
 *   results/
 *     <runId>.json                     one completed run's record
 * ```
 *
 * `basalt evaluate` reads datasets from `data/` and writes run records to
 * `results/`. A `runId` is caller-supplied and already validated (a timestamped
 * slug); the file helper only joins.
 */

/** Directory (under STATE_DIR) that roots all eval state. */
const EVALS_DIR_NAME = 'evals';

/** Subdirectory (under `evals/`) holding the loaded RULER datasets. */
const DATA_DIR_NAME = 'data';

/** Subdirectory (under `evals/`) holding stored eval-run records. */
const RESULTS_DIR_NAME = 'results';

/** Absolute path to `<STATE_DIR>/evals`. */
function evalsDir(env: Env = process.env): string {
  return join(stateDir(env), EVALS_DIR_NAME);
}

/**
 * Env var overriding the RULER dataset root. Normally the datasets live under
 * the config-managed state tree (`<STATE_DIR>/evals/data`, populated by
 * `basalt evaluate load`); set this to run against datasets stored elsewhere
 * (e.g. a shared, pre-generated copy) without moving them.
 */
const RULER_DATA_DIR_ENV_VAR = 'BASALT_RULER_DATA_DIR';

/**
 * Absolute path to the RULER dataset root. Honors {@link RULER_DATA_DIR_ENV_VAR};
 * otherwise `<STATE_DIR>/evals/data`. Layout underneath is
 * `<root>/<nominalLength>/<task>/validation.jsonl` (see {@link taskFile}).
 */
function dataDir(env: Env = process.env): string {
  const override = env[RULER_DATA_DIR_ENV_VAR];
  if (typeof override === 'string' && override.length > 0) {
    return override;
  }
  return join(evalsDir(env), DATA_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/evals/results`. */
function resultsDir(env: Env = process.env): string {
  return join(evalsDir(env), RESULTS_DIR_NAME);
}

/**
 * Absolute path to one task's dataset file:
 * `<root>/<nominalLength>/<task>/validation.jsonl`. `task` MUST already be a
 * validated RULER task name (see `task.ts`); this only joins.
 */
function taskFile(root: string, nominalLength: number, task: string): string {
  return join(root, nominalLength.toString(), task, 'validation.jsonl');
}

/**
 * Absolute path to a single run's record file,
 * `<STATE_DIR>/evals/results/<runId>.json`. `runId` MUST already be a valid slug
 * (see {@link import('./run-id.js').makeRunId}); this only joins.
 */
function runResultFile(runId: string, env: Env = process.env): string {
  return join(resultsDir(env), `${runId}.json`);
}

// State-dir resolution is owned by @basalt/config; re-export the pass-throughs so
// this package and its callers read the same location config/secrets/logs do.
export { type Env, STATE_DIR_ENV_VAR, stateDir } from '@basalt/config';
export {
  DATA_DIR_NAME,
  dataDir,
  evalsDir,
  EVALS_DIR_NAME,
  RESULTS_DIR_NAME,
  resultsDir,
  RULER_DATA_DIR_ENV_VAR,
  runResultFile,
  taskFile,
};
