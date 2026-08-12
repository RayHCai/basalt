import { Command } from 'commander';
import type { CommanderError } from 'commander';

import { runConfigCreate } from './commands/config.js';
import { runCron } from './commands/cron.js';
import { runEvaluate, runEvaluateLoad, runEvaluateReport } from './commands/evaluate.js';
import type { EvaluateCliOptions, EvaluateLoadCliOptions } from './commands/evaluate.js';
import { runInit } from './commands/init.js';
import { runRoot } from './commands/root.js';
import { runSecretSet } from './commands/secret.js';
import { runSessions } from './commands/sessions.js';
import { runStart } from './commands/start.js';
import type { CliContext } from './context.js';
import { UsageError } from './errors.js';

/** The CLI's name and description, shown in `--help`. */
const PROGRAM_NAME = 'basalt';
const PROGRAM_DESCRIPTION = 'Basalt — a small, lightweight CLI agent harness.';

/**
 * Build the commander program for a given context.
 *
 * Wiring choices worth noting:
 * - `exitOverride()` turns commander's `process.exit()` on parse/usage errors
 *   into a thrown {@link CommanderError}, which `run.ts` maps to an exit code.
 *   This keeps the CLI testable (no process teardown mid-parse).
 * - Output (help/errors from commander) is routed through the context writers
 *   so tests capture it and color stays consistent.
 * - Handlers are async; commander's `.action` returns their promise so
 *   `parseAsync` awaits them and rejections propagate to `run.ts`.
 */
function buildProgram(ctx: CliContext): Command {
  const program = new Command();

  program
    .name(PROGRAM_NAME)
    .description(PROGRAM_DESCRIPTION)
    .version(readVersion(), '-v, --version', 'Print the version and exit')
    .option('--no-color', 'Disable colored output')
    .option('--color', 'Force colored output')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => ctx.stdout(str.replace(/\n$/u, '')),
      writeErr: (str) => ctx.stderr(str.replace(/\n$/u, '')),
    });

  // Default command: `basalt [message...]`. `enablePositionalOptions` lets the
  // subcommands own their own flags without the root swallowing them.
  program.enablePositionalOptions();
  program
    .argument(
      '[message...]',
      'Message/task to send the agent (omit to open the interactive prompt)',
    )
    .action(async (message: string[]) => {
      // Fires only for the bare form; a known subcommand routes to its own
      // action instead. With no message this opens the interactive REPL.
      await runRoot(ctx, message);
    });

  program
    .command('sessions')
    .description('Inspect agent sessions')
    .option('-l, --list', 'List all active sessions')
    .option('-w, --watch [id]', 'Stream a session read-only')
    .action(async (options: { list?: boolean; watch?: string | boolean }) => {
      await runSessions(ctx, options);
    });

  program
    .command('cron')
    .description('Inspect scheduled cron jobs')
    .option('-l, --list', 'List all registered cron jobs')
    .action(async (options: { list?: boolean }) => {
      await runCron(ctx, options);
    });

  program
    .command('init')
    .description('Run the config initialization setup')
    .action(async () => {
      await runInit(ctx);
    });

  program
    .command('start')
    .description('Start the primary session service (blocks until terminated)')
    .action(async () => {
      await runStart(ctx);
    });

  // `basalt evaluate [flags]` runs the RULER eval pipeline; `basalt evaluate
  // report` renders stored runs. `enablePositionalOptions` lets the `report`
  // subcommand coexist with the parent's flags without the parent swallowing it.
  const evaluate = program
    .command('evaluate')
    .description('Run the RULER evaluation pipeline (dummy provider by default)')
    .enablePositionalOptions()
    .option('--fraction <f>', 'Fraction of each task to run, in (0, 1] (default 1)')
    .option('--lengths <list>', 'Comma-separated context lengths (e.g. 8k,32k,128k)')
    .option('--tasks <list>', 'Comma-separated RULER tasks (e.g. niah_single_1,vt,qa_1)')
    .option('--max-samples <n>', 'Cap on samples per (task, length)')
    .option('--reps <n>', 'Repetitions per sample at temperature 0 (default 1)')
    .option('--concurrency <n>', 'Max attempts in flight (default 4)')
    .option('--max-input-tokens <n>', 'Per-attempt input-token cap')
    .option('--max-turns <n>', 'Per-attempt turn cap')
    .option('--provider <name>', 'Provider to evaluate (default dummy)')
    .option('--model <name>', 'Model to evaluate (default dummy-model)')
    .option('--no-store', 'Do not persist the run record')
    .action(async (options: EvaluateCliOptions) => {
      await runEvaluate(ctx, options);
    });

  evaluate
    .command('load')
    .description('Generate + store the RULER datasets under STATE_DIR/evals/data')
    .option('--lengths <list>', 'Comma-separated context lengths (e.g. 8k,32k,128k)')
    .option('--tasks <list>', 'Comma-separated RULER tasks (e.g. niah_single_1,vt,qa_1)')
    .option('--samples <n>', 'Samples to generate per (task, length)')
    .option('--seed <n>', 'RNG seed for generation')
    .action(async (options: EvaluateLoadCliOptions) => {
      await runEvaluateLoad(ctx, options);
    });

  evaluate
    .command('report')
    .description('Render stored eval runs: accuracy-vs-tokens plot + metric tables')
    .action(async () => {
      await runEvaluateReport(ctx);
    });

  // `basalt config <subcommand>` — manage config sections. Each create-* seeds a
  // per-name section shell and prints its file path for hand-editing.
  const config = program.command('config').description('Create and manage config sections');
  const creatable = [
    { command: 'create-model-provider', kind: 'model-provider', label: 'model provider' },
    { command: 'create-plugin', kind: 'plugin', label: 'plugin' },
    { command: 'create-tool', kind: 'tool', label: 'tool' },
    { command: 'create-mcp-server', kind: 'mcp-server', label: 'MCP server' },
  ] as const;
  for (const { command, kind, label } of creatable) {
    config
      .command(command)
      .description(`Create a ${label} config section and print its file path`)
      .argument('<name>', `Name of the ${label} (lowercase letters, digits, hyphens)`)
      .action(async (name: string) => {
        await runConfigCreate(ctx, kind, name);
      });
  }

  // `basalt secret set <name>` — seal a secret at rest. The VALUE is never an
  // argument (that would leak to shell history / `ps` / logs): it is read from
  // piped stdin or a no-echo TTY prompt. See commands/secret.ts.
  const secret = program.command('secret').description('Manage encrypted secrets');
  secret
    .command('set')
    .description('Set a secret from stdin or an interactive prompt (never an argument)')
    .argument('<secret_name>', 'Secret name (the ref a config { "$secret": ... } marker points at)')
    .action(async (name: string) => {
      await runSecretSet(ctx, name);
    });

  return program;
}

/**
 * Version string shown by `--version`. Read lazily/defensively: the CLI must
 * not crash if the version cannot be determined.
 */
function readVersion(): string {
  return process.env['npm_package_version'] ?? '0.0.0';
}

/**
 * Translate a thrown {@link CommanderError} into the CLI's error model. Some
 * "errors" are actually clean exits (help/version) — those we let through as
 * successes; genuine parse failures become {@link UsageError}.
 */
function toCliError(error: CommanderError): UsageError | undefined {
  // These codes are commander signalling a normal, zero-exit termination.
  const cleanExitCodes = new Set([
    'commander.help',
    'commander.helpDisplayed',
    'commander.version',
  ]);
  if (cleanExitCodes.has(error.code)) {
    return undefined;
  }
  return new UsageError(error.message);
}

export { buildProgram, PROGRAM_DESCRIPTION, PROGRAM_NAME, toCliError };
