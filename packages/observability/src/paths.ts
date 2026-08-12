import { join } from 'node:path';

import { stateDir } from '@basalt/config';

/**
 * Directory (under STATE_DIR) that holds rotated log files. State-dir resolution
 * itself is owned by `@basalt/config` — {@link stateDir} and
 * {@link STATE_DIR_ENV_VAR} are re-exported from there so this package reads the
 * same location config and secrets do.
 */
const LOGS_DIR_NAME = 'logs';

/** Base file name pino-roll appends `.<date>.<n>.log` to. */
const LOG_FILE_BASE = 'basalt';

type Env = Readonly<Record<string, string | undefined>>;

/** Absolute path to `<STATE_DIR>/logs`. */
function logsDir(env: Env = process.env): string {
  return join(stateDir(env), LOGS_DIR_NAME);
}

/**
 * Absolute path to the base log file, e.g. `<STATE_DIR>/logs/basalt`.
 * pino-roll appends the date + rotation number + `.log` extension, producing
 * files like `basalt.2026-07-08.1.log`.
 */
function logFileBase(env: Env = process.env): string {
  return join(logsDir(env), LOG_FILE_BASE);
}

// State-dir resolution is owned by @basalt/config; re-export the pass-throughs
// directly from there. `stateDir` is also imported above for internal use.
export { STATE_DIR_ENV_VAR, stateDir } from '@basalt/config';
export { LOG_FILE_BASE, LOGS_DIR_NAME, logFileBase, logsDir };
