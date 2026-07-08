import { isAbsolute, join, resolve } from 'node:path';

/**
 * Environment variable that relocates the runtime state directory. When unset,
 * {@link stateDir} falls back to the current working directory (see the root
 * README's STATE_DIR section). `@basalt/config` will eventually own this value;
 * observability only reads it.
 */
const STATE_DIR_ENV_VAR = 'BASALT_STATE_DIR';

/** Directory (under STATE_DIR) that holds rotated log files. */
const LOGS_DIR_NAME = '.logs';

/** Base file name pino-roll appends `.<date>.<n>.log` to. */
const LOG_FILE_BASE = 'basalt';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Absolute path to the runtime state directory. Honors `BASALT_STATE_DIR`
 * (resolved against cwd if it is relative); otherwise the current working
 * directory, matching the README default.
 */
function stateDir(env: Env = process.env): string {
  const override = env[STATE_DIR_ENV_VAR];
  if (typeof override === 'string' && override.length > 0) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return process.cwd();
}

/** Absolute path to `<STATE_DIR>/.logs`. */
function logsDir(env: Env = process.env): string {
  return join(stateDir(env), LOGS_DIR_NAME);
}

/**
 * Absolute path to the base log file, e.g. `<STATE_DIR>/.logs/basalt`.
 * pino-roll appends the date + rotation number + `.log` extension, producing
 * files like `basalt.2026-07-08.1.log`.
 */
function logFileBase(env: Env = process.env): string {
  return join(logsDir(env), LOG_FILE_BASE);
}

export { LOG_FILE_BASE, LOGS_DIR_NAME, logFileBase, logsDir, STATE_DIR_ENV_VAR, stateDir };
