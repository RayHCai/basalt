/**
 * `@basalt/cli` — the commander-based entry point for the `basalt` command.
 *
 * The CLI is deliberately *thin*: it parses arguments, styles output, and
 * delegates each command to its OWNING package (see `context.ts`):
 * - running the agent → `@basalt/runtime` (`run`);
 * - `init` → `@basalt/config` (`initConfig`);
 * - `sessions` / `cron` → `@basalt/storage` (via a `StorageReader`; a shell
 *   until storage is built).
 * The runtime is only for running the agent — the other subcommands do NOT pass
 * through it. The executable lives in `bin.ts`; this module is the library
 * surface for embedding/testing the CLI.
 *
 * Commands:
 * - `basalt`                   open the interactive prompt (REPL)
 * - `basalt [message...]`      send a one-shot message/task to the agent
 * - `basalt sessions --list`   list active sessions
 * - `basalt sessions --watch`  stream a session read-only
 * - `basalt cron --list`       list registered cron jobs
 * - `basalt init`              run the config initialization setup
 * - `basalt evaluate`          run the RULER evaluation pipeline
 * - `basalt evaluate report`   render stored eval runs
 */
export { PLAIN, type Palette, selectPalette, shouldUseColor } from './colors.js';
export {
  type CliContext,
  createContext,
  type CreateContextOptions,
  type Evaluate,
  type InitConfig,
  type LoadEvalData,
  type LoadEvalRuns,
  type RuntimeRun,
  type SetSecret,
  type Writer,
} from './context.js';
export type { CronJobInfo, SessionEvent, SessionInfo } from './domain.js';
export {
  createSecretValueReader,
  type ReadSecretValue,
  type SecretInputStream,
  type SecretValueReaderOptions,
} from './secret-input.js';
export { defaultStorageReader, type StorageReader } from './storage.js';
export {
  CliError,
  EXIT_CODES,
  type ExitCode,
  isCliError,
  NotFoundError,
  UsageError,
} from './errors.js';
export { buildProgram, PROGRAM_DESCRIPTION, PROGRAM_NAME, toCliError } from './program.js';
export {
  makeReadlinePrompter,
  type OpenPrompter,
  openNodePrompter,
  type Prompter,
} from './prompt.js';
export { detectColorFlag, run, type RunOptions } from './run.js';
