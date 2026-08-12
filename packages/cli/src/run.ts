import { NotImplementedError, RuntimeError } from '@basalt/runtime';
import { StorageError } from '@basalt/storage';
import { CommanderError } from 'commander';

import { createContext } from './context.js';
import type { CreateContextOptions } from './context.js';
import { EXIT_CODES, isCliError } from './errors.js';
import type { ExitCode } from './errors.js';
import { buildProgram, toCliError } from './program.js';

/** Options for {@link run}, mostly to make it testable. */
interface RunOptions extends CreateContextOptions {
  /**
   * Argument vector WITHOUT the leading `node` and script path — i.e. what
   * `process.argv.slice(2)` yields. Defaults to that slice.
   */
  argv?: readonly string[] | undefined;
}

/**
 * Parse and execute a Basalt CLI invocation.
 *
 * Never throws and never calls `process.exit` — it resolves to the exit code
 * the caller (`bin.ts`) should exit with. All errors are caught here and
 * rendered as a single terse line (for expected {@link isCliError} failures and
 * commander usage errors) or with a stack (for unexpected crashes, which are
 * bugs).
 */
async function run(options: RunOptions = {}): Promise<ExitCode> {
  const argv = options.argv ?? process.argv.slice(2);

  // Detect the color flags ourselves so the context palette is right even for
  // output produced during parsing (e.g. help/usage errors).
  const color = detectColorFlag(argv);
  const ctx = createContext({
    ...(options.run === undefined ? {} : { run: options.run }),
    ...(options.resolvePrimary === undefined ? {} : { resolvePrimary: options.resolvePrimary }),
    ...(options.startPrimary === undefined ? {} : { startPrimary: options.startPrimary }),
    ...(options.initConfig === undefined ? {} : { initConfig: options.initConfig }),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(color === undefined ? {} : { color }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.openPrompter === undefined ? {} : { openPrompter: options.openPrompter }),
  });

  const program = buildProgram(ctx);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return EXIT_CODES.ok;
  } catch (error: unknown) {
    return renderError(ctx.stderr, ctx.palette.red, error);
  }
}

/**
 * Scan argv for `--color` / `--no-color`. Returns `true`, `false`, or
 * `undefined` (auto). The last occurrence wins.
 */
function detectColorFlag(argv: readonly string[]): boolean | undefined {
  // oxlint-disable-next-line init-declarations
  let decision: boolean | undefined;
  for (const arg of argv) {
    if (arg === '--color') {
      decision = true;
    } else if (arg === '--no-color') {
      decision = false;
    }
  }
  return decision;
}

/** Render a caught error and return the exit code to use. */
function renderError(
  stderr: (text: string) => void,
  red: (text: string) => string,
  error: unknown,
): ExitCode {
  // Commander parse/usage failures — help/version are clean exits.
  if (error instanceof CommanderError) {
    const usage = toCliError(error);
    if (usage === undefined) {
      return EXIT_CODES.ok;
    }
    stderr(red(`error: ${usage.message}`));
    return usage.exitCode;
  }

  // Expected CLI failures: one terse line, no stack.
  if (isCliError(error)) {
    stderr(red(`error: ${error.message}`));
    return error.exitCode;
  }

  // Storage errors the CLI observes directly (e.g. claiming a primary that
  // another `basalt start` already holds). Expected and terse.
  if (error instanceof StorageError) {
    stderr(red(`error: ${error.message}`));
    return EXIT_CODES.failure;
  }

  // Errors raised by the runtime. They carry no exit code (that is the CLI's
  // policy to set), so map them here: a not-yet-implemented operation is an
  // internal-software condition (70); any other runtime error is a generic
  // failure (1). Either way it is an expected, terse failure — not a crash.
  if (error instanceof RuntimeError) {
    stderr(red(`error: ${error.message}`));
    return error instanceof NotImplementedError ? EXIT_CODES.software : EXIT_CODES.failure;
  }

  // Anything else is an unexpected crash (a bug). Surface the detail.
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  stderr(red(`unexpected error: ${message}`));
  return EXIT_CODES.failure;
}

export { detectColorFlag, run, type RunOptions };
