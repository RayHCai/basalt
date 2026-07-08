/**
 * Log levels for Basalt. A strict subset of pino's built-in levels (pino also
 * defines `fatal`, which we intentionally omit — `error` is the top severity
 * we surface), plus `silent` to disable output entirely.
 *
 * Ordered least → most severe. `silent` is a sentinel, not a real severity.
 */
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

/** A Basalt log level name. */
type LogLevel = (typeof LEVELS)[number];

/** The level used when nothing else is configured. */
const DEFAULT_LEVEL: LogLevel = 'info';

/** Environment variable that overrides the default level process-wide. */
const LEVEL_ENV_VAR = 'BASALT_LOG_LEVEL';

const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS);

/** True when `value` is one of the recognized {@link LogLevel} names. */
function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LEVEL_SET.has(value);
}

/**
 * Resolve the effective level from an explicit value and/or an environment map.
 *
 * Precedence: explicit `level` argument › `BASALT_LOG_LEVEL` env var ›
 * {@link DEFAULT_LEVEL}. Unrecognized values (from either source) are ignored
 * so a typo can never silently disable logging. Pass `env: {}` to opt out of
 * environment resolution entirely.
 */
function resolveLevel(
  level?: LogLevel | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LogLevel {
  if (isLogLevel(level)) {
    return level;
  }
  const fromEnv = env[LEVEL_ENV_VAR];
  if (isLogLevel(fromEnv)) {
    return fromEnv;
  }
  return DEFAULT_LEVEL;
}

export { DEFAULT_LEVEL, isLogLevel, LEVEL_ENV_VAR, LEVELS, type LogLevel, resolveLevel };
