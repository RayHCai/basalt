import type { Attempt, Clock } from './instrument.js';
import { computeMetrics, runInstrumented } from './instrument.js';
import { runPool } from './pool.js';
import { scoreOutput } from './ruler/scorer.js';
import type { Sample, SampleMetrics, SampleResult } from './task.js';

/**
 * The runner: drive every sample through the harness, N reps each, in parallel,
 * with per-attempt token/turn caps, instrumenting and scoring each attempt into
 * a {@link SampleResult}.
 *
 * Design points that matter for a benchmark:
 *  - **Reps at temperature 0.** Reps exist to measure run-to-run variance; the
 *    temperature is fixed at 0 (carried in the run params, honored by a real
 *    provider) so the bring-up is reproducible. Each rep is still a distinct
 *    graded attempt.
 *  - **Caps are guardrails, not scores.** An attempt whose input exceeds
 *    `maxInputTokens`, or that a provider runs past `maxTurns`, is recorded as a
 *    FAILED attempt with an `error` — never silently dropped, so the report's
 *    denominators stay honest.
 *  - **Errors never abort the run.** A provider/harness throw is caught per
 *    attempt and recorded as a failed result; other attempts proceed.
 */

/** The harness surface the runner needs: turn an input into a raw {@link Attempt}. */
type AttemptFn = (input: string) => Promise<Attempt>;

/** Options for {@link runSamples}. */
interface RunnerOptions {
  /** Repetitions per sample (each a distinct graded attempt). Defaults to `1`. */
  reps?: number;
  /** Max attempts in flight at once. Defaults to `4`. */
  concurrency?: number;
  /**
   * Per-attempt input-token cap. An attempt whose sample input exceeds this is
   * short-circuited to a failed result (no provider call). `null` = uncapped
   * (the default).
   */
  maxInputTokens?: number | null;
  /**
   * Per-attempt turn cap. Enforced after the attempt against the reported turn
   * count: an attempt that took more turns is marked failed. `null` = uncapped
   * (the default). (With the straight-through dummy path every attempt is 1
   * turn, so this is a no-op there; it matters once a real multi-turn agent is
   * wired.)
   */
  maxTurns?: number | null;
  /** Monotonic clock for instrumentation timing. Injectable for tests. */
  clock?: Clock;
}

/** One unit of work: a sample paired with the rep index to run it as. */
interface WorkItem {
  readonly sample: Sample;
  readonly rep: number;
}

/** Default attempts in flight at once. */
const DEFAULT_CONCURRENCY = 4;

/** Build the flat list of `(sample, rep)` work items for the grid. */
function buildWorkItems(samples: readonly Sample[], reps: number): WorkItem[] {
  const items: WorkItem[] = [];
  for (const sample of samples) {
    for (let rep = 0; rep < reps; rep += 1) {
      items.push({ sample, rep });
    }
  }
  return items;
}

/** A zeroed metrics object for an attempt that never called the provider. */
function skippedMetrics(sample: Sample): SampleMetrics {
  return {
    inputTokens: sample.inputTokens,
    cachedInputTokens: 0,
    uncachedInputTokens: sample.inputTokens,
    outputTokens: 0,
    peakContextTokens: sample.inputTokens,
    turns: 0,
    durationMs: 0,
  };
}

/** A failed {@link SampleResult} carrying an error, scoring 0. */
function failedResult(
  item: WorkItem,
  error: string,
  metrics: SampleMetrics,
  output = '',
): SampleResult {
  return {
    sampleId: item.sample.id,
    task: item.sample.task,
    nominalLength: item.sample.nominalLength,
    rep: item.rep,
    output,
    passed: false,
    score: 0,
    metrics,
    error,
  };
}

/** Execute one work item into a graded {@link SampleResult}, capturing any error. */
async function runOne(
  item: WorkItem,
  attempt: AttemptFn,
  options: Required<Pick<RunnerOptions, 'maxInputTokens' | 'maxTurns'>>,
  clock: Clock,
): Promise<SampleResult> {
  const { sample } = item;

  // Input-token cap: short-circuit before spending a provider call.
  if (options.maxInputTokens !== null && sample.inputTokens > options.maxInputTokens) {
    return failedResult(
      item,
      `input ${sample.inputTokens.toString()} tokens exceeds cap ${options.maxInputTokens.toString()}`,
      skippedMetrics(sample),
    );
  }

  // oxlint-disable-next-line init-declarations
  let ran: { attempt: Attempt; metrics: SampleMetrics };
  // Stamp the start here so a failed attempt still records the elapsed time it
  // burned before throwing (runInstrumented rejects without returning a
  // duration, so we time the error path ourselves).
  const startedAt = clock();
  try {
    ran = await runInstrumented(sample, () => attempt(sample.input), clock);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Math.max(0, clock() - startedAt);
    return failedResult(item, message, computeMetrics(sample, { output: '' }, durationMs));
  }

  // Turn cap: an attempt that overran its turn budget is a failure, not a score.
  if (options.maxTurns !== null && ran.metrics.turns > options.maxTurns) {
    return failedResult(
      item,
      `used ${ran.metrics.turns.toString()} turns, exceeds cap ${options.maxTurns.toString()}`,
      ran.metrics,
      ran.attempt.output,
    );
  }

  const score = scoreOutput(sample, ran.attempt.output);
  return {
    sampleId: sample.id,
    task: sample.task,
    nominalLength: sample.nominalLength,
    rep: item.rep,
    output: ran.attempt.output,
    passed: score.passed,
    score: score.score,
    metrics: ran.metrics,
  };
}

/**
 * Run all `samples` through `attempt`, `reps` times each, at `concurrency`
 * attempts in flight, applying the caps. Resolves to one {@link SampleResult}
 * per `(sample, rep)` in deterministic grid order (sample order, then rep). Never
 * rejects for an attempt error — those become failed results.
 */
// oxlint-disable-next-line require-await -- async to lock the Promise return contract; body returns runPool's promise
async function runSamples(
  samples: readonly Sample[],
  attempt: AttemptFn,
  options: RunnerOptions = {},
): Promise<SampleResult[]> {
  const reps = Math.max(1, Math.floor(options.reps ?? 1));
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const clock = options.clock ?? ((): number => Date.now());
  const caps = {
    maxInputTokens: options.maxInputTokens ?? null,
    maxTurns: options.maxTurns ?? null,
  };

  const items = buildWorkItems(samples, reps);
  const tasks = items.map((item) => () => runOne(item, attempt, caps, clock));
  return runPool(tasks, concurrency);
}

export { type AttemptFn, buildWorkItems, DEFAULT_CONCURRENCY, type RunnerOptions, runSamples };
