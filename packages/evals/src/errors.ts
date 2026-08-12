/**
 * Errors raised by `@basalt/evals`.
 *
 * Like `@basalt/runtime`'s taxonomy, these deliberately carry NO process exit
 * codes — mapping a failure to an exit code is the CLI's concern. The CLI
 * recognizes {@link EvalError} and renders it as a terse, expected failure
 * (rather than an unexpected crash with a stack).
 */

/* oxlint-disable max-classes-per-file -- a small error taxonomy belongs together */

/** Base class for every error `@basalt/evals` raises intentionally. */
class EvalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EvalError';
  }
}

/**
 * A caller passed an invalid evaluation parameter (an out-of-range task
 * fraction, an unknown context length, a bad category name, …). Thrown before
 * any work starts so the CLI can report it as a usage-shaped failure.
 */
class EvalConfigError extends EvalError {
  constructor(message: string) {
    super(message);
    this.name = 'EvalConfigError';
  }
}

/**
 * A stored eval run could not be read back (missing file, malformed JSON, or a
 * record that fails schema validation). Raised by the store/report path.
 */
class EvalResultError extends EvalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EvalResultError';
  }
}

export { EvalConfigError, EvalError, EvalResultError };
