import type { Sample, SampleMetrics } from './task.js';
import { estimateTokens } from './tokens.js';

/**
 * Instrumentation: wrap every attempt at a sample and record the measurements
 * the report plots — input tokens (cached/uncached), output tokens, peak
 * context, turns, and wall-clock duration.
 *
 * A model provider MAY report real usage (a provider that exposes token counts
 * and cache stats). The dummy provider reports none, so instrumentation falls
 * back to the deterministic chars/4 estimate over the sample input and the
 * output text. Whatever a provider reports always wins over the estimate — the
 * estimate only fills the gaps.
 */

/**
 * Optional usage a provider surfaces for one attempt. Every field is optional so
 * a provider reports only what it knows; instrumentation estimates the rest.
 * (The dummy provider reports nothing, so all fields are absent.)
 */
interface RawUsage {
  /** Total input tokens the provider billed/consumed. */
  readonly inputTokens?: number;
  /** Of the input, how many were served from cache. */
  readonly cachedInputTokens?: number;
  /** Output (completion) tokens produced. */
  readonly outputTokens?: number;
  /** Peak single-turn context (input + output) observed. */
  readonly peakContextTokens?: number;
  /** Number of agent turns taken. */
  readonly turns?: number;
}

/** The raw result of one attempt, before scoring: output text + optional usage. */
interface Attempt {
  /** The text the agent returned. */
  readonly output: string;
  /** Usage the provider reported, if any. */
  readonly usage?: RawUsage;
}

/** A monotonic clock in milliseconds. Injectable so tests are deterministic. */
type Clock = () => number;

/**
 * Compute {@link SampleMetrics} for one attempt. Uses reported usage where
 * present and the chars/4 estimate otherwise:
 *
 *  - `inputTokens` — reported, else the sample's generation-time estimate.
 *  - `cachedInputTokens` — reported, else 0 (nothing is known to be cached).
 *  - `uncachedInputTokens` — `inputTokens − cachedInputTokens`, floored at 0.
 *  - `outputTokens` — reported, else estimated from the output text.
 *  - `peakContextTokens` — reported, else `inputTokens + outputTokens` (the
 *    single-turn context size).
 *  - `turns` — reported, else 1 (the straight-through path).
 */
function computeMetrics(sample: Sample, attempt: Attempt, durationMs: number): SampleMetrics {
  const usage = attempt.usage ?? {};

  const inputTokens = usage.inputTokens ?? sample.inputTokens;
  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, inputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = usage.outputTokens ?? estimateTokens(attempt.output);
  const peakContextTokens = usage.peakContextTokens ?? inputTokens + outputTokens;
  const turns = usage.turns ?? 1;

  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    peakContextTokens,
    turns,
    durationMs,
  };
}

/**
 * Run and time one instrumented attempt. Calls `attempt()` (which drives the
 * agent for `sample`), measures its wall-clock duration with `clock`, and
 * returns the raw attempt plus its computed {@link SampleMetrics}. Does NOT
 * catch errors — a failed attempt rejects, and the runner decides how to record
 * it (see `runner.ts`); this keeps timing/measurement separate from policy.
 */
async function runInstrumented(
  sample: Sample,
  attempt: () => Promise<Attempt>,
  clock: Clock = () => Date.now(),
): Promise<{ attempt: Attempt; metrics: SampleMetrics }> {
  const startedAt = clock();
  const result = await attempt();
  const durationMs = Math.max(0, clock() - startedAt);
  return { attempt: result, metrics: computeMetrics(sample, result, durationMs) };
}

export { type Attempt, type Clock, computeMetrics, type RawUsage, runInstrumented };
