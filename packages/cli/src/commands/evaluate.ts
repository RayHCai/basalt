import {
  isContextLength,
  isTask,
  parseLength,
  renderReport,
  renderTable,
  TASKS,
} from '@basalt/evals';
import type { ContextLength, EvaluateOptions, LoadDataOptions, Task } from '@basalt/evals';

import type { CliContext } from '../context.js';
import { UsageError } from '../errors.js';
import { createSpinner } from '../spinner.js';

/**
 * Handle `basalt evaluate` — run the RULER evaluation pipeline, and its
 * `report` subcommand — render stored runs.
 *
 * Like `init`/`sessions`/`cron`, evaluation is NOT routed through
 * `@basalt/runtime` (which owns the interactive agent path): `@basalt/evals`
 * stands up its OWN runtime pinned to a provider, so the CLI calls it directly
 * via injected context seams. Pure renderers (`renderTable`/`renderReport`) are
 * imported directly, exactly as the session/cron renderers are.
 *
 * IMPORTANT: the pipeline is validated with the `dummy` provider ONLY (the
 * default). The dummy returns a constant and fails every score — that ~0
 * accuracy is the intended end-to-end signal, not a real measurement.
 */

/** Raw option strings as commander parses them for `basalt evaluate`. */
interface EvaluateCliOptions {
  /** `--fraction <f>`: fraction of each task's samples to run, in (0, 1]. */
  fraction?: string;
  /** `--lengths <list>`: comma-separated context lengths (e.g. `8k,32k,128k`). */
  lengths?: string;
  /** `--tasks <list>`: comma-separated RULER task names. */
  tasks?: string;
  /** `--max-samples <n>`: cap on samples taken per (task, length). */
  maxSamples?: string;
  /** `--reps <n>`: repetitions per sample (all at temperature 0). */
  reps?: string;
  /** `--concurrency <n>`: max attempts in flight. */
  concurrency?: string;
  /** `--max-input-tokens <n>`: per-attempt input-token cap. */
  maxInputTokens?: string;
  /** `--max-turns <n>`: per-attempt turn cap. */
  maxTurns?: string;
  /** `--provider <name>`: provider to evaluate (default `dummy`). */
  provider?: string;
  /** `--model <name>`: model to evaluate (default `dummy-model`). */
  model?: string;
  /** `--store` / `--no-store`: whether to persist the run (default persist). */
  store?: boolean;
}

/**
 * Run one evaluation: parse + validate the flags, invoke `@basalt/evals`'
 * `evaluate` via the injected seam, then print the run's metric table and where
 * it was stored.
 */
async function runEvaluate(ctx: CliContext, options: EvaluateCliOptions): Promise<void> {
  const evaluateOptions = buildEvaluateOptions(options);

  ctx.stdout(ctx.palette.bold('Running evaluation…'));
  const provider = options.provider ?? 'dummy';
  if (provider === 'dummy') {
    ctx.stdout(
      ctx.palette.dim(
        '  Using the dummy provider — accuracy is expected to be ~0 (pipeline smoke test).',
      ),
    );
  }

  const { record, path } = await ctx.evaluate(evaluateOptions);

  ctx.stdout('');
  ctx.stdout(renderTable(record));
  ctx.stdout('');
  if (path === null) {
    ctx.stdout(ctx.palette.dim('Run not stored (--no-store).'));
  } else {
    ctx.stdout(ctx.palette.green(`Stored run ${record.runId}`));
    ctx.stdout(ctx.palette.dim(`  ${path}`));
  }
}

/** Handle `basalt evaluate report` — render every stored run. */
async function runEvaluateReport(ctx: CliContext): Promise<void> {
  const records = await ctx.loadEvalRuns();
  ctx.stdout(renderReport(records));
}

/** Raw option strings for `basalt evaluate load`. */
interface EvaluateLoadCliOptions {
  /** `--lengths <list>`: comma-separated context lengths. */
  lengths?: string;
  /** `--tasks <list>`: comma-separated RULER task names. */
  tasks?: string;
  /** `--samples <n>`: samples to generate per (task, length). */
  samples?: string;
  /** `--seed <n>`: RNG seed for generation. */
  seed?: string;
}

/**
 * Handle `basalt evaluate load` — generate the RULER datasets (via
 * `@basalt/evals`' `loadData`, which drives `scripts/generate-ruler-data.sh`)
 * into `<STATE_DIR>/evals/data`, then confirm they load. Generation is minutes
 * of work (clone + Python setup + corpora download + generation), so a spinner
 * streams the script's progress lines; the spinner writes to stderr, leaving
 * stdout for the final summary.
 */
async function runEvaluateLoad(ctx: CliContext, options: EvaluateLoadCliOptions): Promise<void> {
  const loadOptions = buildLoadDataOptions(options);
  const spinner = createSpinner({ palette: ctx.palette });

  ctx.stdout(ctx.palette.bold('Loading RULER datasets…'));
  ctx.stdout(
    ctx.palette.dim(
      '  Running NVIDIA RULER generators (clone + Python setup + corpora + generate).',
    ),
  );
  spinner.start('starting…');
  try {
    const result = await ctx.loadEvalData({
      ...loadOptions,
      onProgress: (line) => {
        spinner.update(line);
      },
    });
    spinner.stop();
    ctx.stdout(
      ctx.palette.green(
        `Loaded ${result.totalSamples.toString()} samples across ${result.loaded.length.toString()} (task, length) files.`,
      ),
    );
    ctx.stdout(ctx.palette.dim(`  ${result.dataDir}`));
  } catch (error: unknown) {
    // Clear the spinner line before the error propagates to the top-level runner.
    spinner.stop();
    throw error;
  }
}

/** Translate `basalt evaluate load` flags into {@link LoadDataOptions}. */
function buildLoadDataOptions(options: EvaluateLoadCliOptions): LoadDataOptions {
  const result: LoadDataOptions = {};
  if (options.lengths !== undefined) {
    result.lengths = parseLengths(options.lengths);
  }
  if (options.tasks !== undefined) {
    result.tasks = parseTasks(options.tasks);
  }
  if (options.samples !== undefined) {
    result.samples = parsePositiveInt(options.samples, '--samples');
  }
  if (options.seed !== undefined) {
    result.seed = parsePositiveInt(options.seed, '--seed');
  }
  return result;
}

/**
 * Translate the raw CLI option strings into a typed {@link EvaluateOptions},
 * validating each and throwing {@link UsageError} on the first problem so a bad
 * flag is a terse exit-2 usage error rather than an opaque crash. Keys are
 * included only when supplied (exactOptionalPropertyTypes-safe).
 */
function buildEvaluateOptions(options: EvaluateCliOptions): EvaluateOptions {
  const load: {
    fraction?: number;
    lengths?: readonly ContextLength[];
    tasks?: readonly Task[];
    maxSamplesPerTask?: number;
  } = {};

  if (options.fraction !== undefined) {
    load.fraction = parseFraction(options.fraction);
  }
  if (options.lengths !== undefined) {
    load.lengths = parseLengths(options.lengths);
  }
  if (options.tasks !== undefined) {
    load.tasks = parseTasks(options.tasks);
  }
  if (options.maxSamples !== undefined) {
    load.maxSamplesPerTask = parsePositiveInt(options.maxSamples, '--max-samples');
  }

  const result: EvaluateOptions = { load };
  if (options.reps !== undefined) {
    result.reps = parsePositiveInt(options.reps, '--reps');
  }
  if (options.concurrency !== undefined) {
    result.concurrency = parsePositiveInt(options.concurrency, '--concurrency');
  }
  if (options.maxInputTokens !== undefined) {
    result.maxInputTokens = parsePositiveInt(options.maxInputTokens, '--max-input-tokens');
  }
  if (options.maxTurns !== undefined) {
    result.maxTurns = parsePositiveInt(options.maxTurns, '--max-turns');
  }
  if (options.provider !== undefined || options.model !== undefined) {
    result.harness = {
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
    };
  }
  // Commander's `--no-store` defaults `store` to true and sets it false when
  // passed. Map that onto `persist` so the flag actually suppresses writing the
  // run (evaluate() defaults persist=true when the key is absent).
  if (options.store === false) {
    result.persist = false;
  }
  return result;
}

/** Parse the `--fraction` value, requiring `(0, 1]`. */
function parseFraction(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new UsageError(`--fraction must be a number in (0, 1]; got "${raw}".`);
  }
  return value;
}

/** Parse a comma-separated length list, validating each is a supported length. */
function parseLengths(raw: string): ContextLength[] {
  const parts = splitList(raw);
  const lengths: ContextLength[] = [];
  for (const part of parts) {
    const tokens = parseLength(part);
    if (tokens === undefined || !isContextLength(tokens)) {
      throw new UsageError(
        `--lengths: "${part}" is not a supported context length (use 8k, 32k, or 128k).`,
      );
    }
    lengths.push(tokens);
  }
  if (lengths.length === 0) {
    throw new UsageError('--lengths must list at least one context length.');
  }
  return lengths;
}

/** Parse a comma-separated task list, validating each is a known RULER task. */
function parseTasks(raw: string): Task[] {
  const parts = splitList(raw);
  const tasks: Task[] = [];
  for (const part of parts) {
    if (!isTask(part)) {
      throw new UsageError(
        `--tasks: "${part}" is not a known RULER task (one of: ${TASKS.join(', ')}).`,
      );
    }
    tasks.push(part);
  }
  if (tasks.length === 0) {
    throw new UsageError('--tasks must list at least one task.');
  }
  return tasks;
}

/** Parse a required positive integer flag. */
function parsePositiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`${flag} must be a positive integer; got "${raw}".`);
  }
  return value;
}

/** Split a comma-separated list, trimming and dropping empty entries. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export {
  buildEvaluateOptions,
  buildLoadDataOptions,
  type EvaluateCliOptions,
  type EvaluateLoadCliOptions,
  runEvaluate,
  runEvaluateLoad,
  runEvaluateReport,
};
