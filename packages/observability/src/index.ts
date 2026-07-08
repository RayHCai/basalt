/**
 * `@basalt/observability` — the logging layer every Basalt package imports.
 *
 * Logs are structured JSONL, written per-subsystem (tagged `basalt.<pkg>`),
 * rotated by size and daily, and pruned after 30 days. Files live under
 * `<STATE_DIR>/.logs/`.
 *
 * Typical use:
 * ```ts
 * import { getLogger } from '@basalt/observability';
 * const log = getLogger('config');
 * log.info({ dir }, 'loaded config');
 * ```
 *
 * At startup, once the state directory is known, call `configureRootLogger()`
 * to switch from the console-only bootstrap root to file-backed logging.
 */
export type { Logger } from 'pino';
export { DEFAULT_MAX_AGE_DAYS, pruneOldLogs, type PruneResult } from './cleanup.js';
export {
  DEFAULT_LEVEL,
  isLogLevel,
  LEVEL_ENV_VAR,
  LEVELS,
  type LogLevel,
  resolveLevel,
} from './levels.js';
export {
  LOG_FILE_BASE,
  LOGS_DIR_NAME,
  logFileBase,
  logsDir,
  STATE_DIR_ENV_VAR,
  stateDir,
} from './paths.js';
export {
  configureRootLogger,
  createLogger,
  getLogger,
  getRootLogger,
  setRootLogger,
} from './logger.js';
export { buildRoot, type RootHandle, type RootOptions, SUBSYSTEM_PREFIX } from './root.js';
