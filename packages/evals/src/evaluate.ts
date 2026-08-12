import { getLogger } from '@basalt/observability';
import type { Logger } from '@basalt/observability';

import { aggregate } from './aggregate.js';
import { createHarness } from './harness.js';
import type { HarnessOptions } from './harness.js';
import type { Clock } from './instrument.js';
import type { Env } from './paths.js';
import type { RunParams, RunRecord } from './record.js';
import { loadSamples } from './ruler/load.js';
import type { LoadOptions } from './ruler/load.js';
import { runSamples } from './runner.js';
import type { RunnerOptions } from './runner.js';
import { makeRunId } from './run-id.js';
import { saveRun } from './store.js';

/**
 * The top-level orchestration for `basalt evaluate`: LOAD the selected RULER
 * samples, stand up the eval harness (its own runtime, pinned to a provider),
 * RUN every sample × rep through the runner (parallel, capped, instrumented,
 * scored), AGGREGATE the results, and STORE the record under
 * `<STATE_DIR>/evaluation-results`.
 *
 * Every collaborator is injectable so the whole flow is testable without a
 * provider on disk or writing real files. In production the defaults wire the
 * real harness (dummy provider) and the on-disk store.
 *
 * IMPORTANT: validated with the `dummy` provider ONLY — it returns a constant
 * and fails every score, which is the intended bring-up signal (the pipeline
 * runs end to end; accuracy is expected to be ~0).
 */

/** Options for {@link evaluate}. Selection + execution + wiring, all optional. */
interface EvaluateOptions {
  /** Sample-selection options (fraction, lengths, categories, samplesPerTask). */
  load?: LoadOptions;
  /** Repetitions per sample (all at temperature 0). Defaults to `1`. */
  reps?: number;
  /** Sampling temperature carried into the record. Defaults to `0`. */
  temperature?: number;
  /** Max attempts in flight. Defaults to the runner's default. */
  concurrency?: number;
  /** Per-attempt input-token cap, or `null` (default) for uncapped. */
  maxInputTokens?: number | null;
  /** Per-attempt turn cap, or `null` (default) for uncapped. */
  maxTurns?: number | null;
  /** Harness wiring (provider/model + injectable config/start seams). */
  harness?: HarnessOptions;
  /** Environment map (state-dir resolution for the store). Defaults to `process.env`. */
  env?: Env;
  /** Monotonic clock (run-id timestamp + instrumentation). Defaults to `Date.now`. */
  clock?: Clock;
  /** Logger. Defaults to a subsystem logger tagged `evals`. */
  logger?: Logger;
  /**
   * Persist the run record. Defaults to `true`. Set `false` to compute a record
   * without touching disk (the store is still returned).
   */
  persist?: boolean;
}

/** What {@link evaluate} produces: the run record and where it was written. */
interface EvaluateResult {
  /** The completed run record (metrics + every attempt). */
  readonly record: RunRecord;
  /** Absolute path the record was written to, or `null` when `persist: false`. */
  readonly path: string | null;
}

/** Default reps per sample. */
const DEFAULT_REPS = 1;

/**
 * Run one full evaluation and return its record. Steps, in order: configure the
 * harness's runtime, load samples, run them, aggregate, then (unless
 * `persist: false`) save the record.
 */
async function evaluate(options: EvaluateOptions = {}): Promise<EvaluateResult> {
  const env = options.env ?? process.env;
  const clock = options.clock ?? ((): number => Date.now());
  const logger = options.logger ?? getLogger('evals');
  const reps = Math.max(1, Math.floor(options.reps ?? DEFAULT_REPS));
  const temperature = options.temperature ?? 0;
  const persist = options.persist ?? true;

  const harness = createHarness(options.harness);
  const load = options.load ?? {};

  logger.info({ provider: harness.provider, model: harness.model, reps }, 'evaluation starting');

  // 1. Stand up the eval runtime (configure the shared config store).
  await harness.configure();

  // 2. Load the selected samples from the RULER datasets on disk.
  const samples = await loadSamples({ ...load, env });
  logger.info({ samples: samples.length }, 'samples loaded');

  // 3. Run every sample × rep.
  const runnerOptions: RunnerOptions = {
    reps,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    maxInputTokens: options.maxInputTokens ?? null,
    maxTurns: options.maxTurns ?? null,
    clock,
  };
  const results = await runSamples(samples, harness.attempt, runnerOptions);

  // 4. Aggregate.
  const metrics = aggregate(results);

  // 5. Assemble the record.
  const runId = makeRunId(clock(), harness.provider);
  const params: RunParams = {
    fraction: load.fraction ?? 1,
    lengths: dedupe(samples.map((s) => s.nominalLength)),
    tasks: dedupe(samples.map((s) => s.task)),
    maxSamplesPerTask: load.maxSamplesPerTask ?? null,
    reps,
    temperature,
    maxInputTokens: options.maxInputTokens ?? null,
    maxTurns: options.maxTurns ?? null,
    provider: harness.provider,
    model: harness.model,
  };
  const record: RunRecord = {
    version: 1,
    runId,
    createdAt: new Date(clock()).toISOString(),
    params,
    results,
    metrics,
  };

  logger.info(
    { runId, attempts: metrics.attempts, accuracy: metrics.accuracy },
    'evaluation complete',
  );

  // 6. Persist (unless disabled).
  const path = persist ? await saveRun(record, { env }) : null;
  return { record, path };
}

/** Distinct values in first-seen order (for the record's params provenance). */
function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export { DEFAULT_REPS, evaluate, type EvaluateOptions, type EvaluateResult };
