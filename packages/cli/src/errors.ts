// A cohesive error taxonomy legitimately lives in a single file; the base class
// plus its variants belong together.
/* oxlint-disable max-classes-per-file */
/**
 * The CLI's error model. Every failure the CLI reports deliberately derives
 * from {@link CliError} so the top-level runner (`run.ts`) can render a clean,
 * single-line message and map the failure to a stable process exit code — as
 * opposed to dumping a stack trace for an unexpected crash.
 *
 * Exit codes follow common CLI convention:
 *   0  success
 *   1  generic runtime failure
 *   2  usage error (bad flags/arguments) — matches commander's own default
 *  70  internal software error (e.g. a not-yet-implemented runtime operation)
 *
 * Note: errors raised BY the runtime (`@basalt/runtime`) are their own types
 * and do NOT extend {@link CliError} — the runtime has no business knowing
 * about process exit codes. `run.ts` recognizes them and assigns exit codes.
 */

/** Process exit codes the CLI can produce. */
const EXIT_CODES = {
  ok: 0,
  failure: 1,
  usage: 2,
  software: 70,
} as const;

type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/**
 * Base class for every error the CLI raises intentionally. Carries the exit
 * code the process should terminate with. `run.ts` prints `.message` (no stack)
 * for these; any non-`CliError` bubbling up is treated as an unexpected crash.
 */
class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode = EXIT_CODES.failure) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/**
 * The user invoked a command incorrectly — unknown flag, bad argument shape,
 * missing required value. Exit code 2, matching commander's convention.
 */
class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.usage);
    this.name = 'UsageError';
  }
}

/**
 * A requested value could not be found (e.g. `sessions --watch <id>` for an id
 * that is not live). Generic failure exit code.
 */
class NotFoundError extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.failure);
    this.name = 'NotFoundError';
  }
}

/** Type guard: is this a CliError we should render tersely (vs. a crash)? */
function isCliError(value: unknown): value is CliError {
  return value instanceof CliError;
}

export { CliError, EXIT_CODES, type ExitCode, isCliError, NotFoundError, UsageError };
