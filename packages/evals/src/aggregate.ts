import type { CellMetrics, RunMetrics } from './record.js';
import type { SampleResult, Task } from './task.js';
import type { ContextLength } from './tokens.js';

/**
 * Derive aggregate {@link RunMetrics} from a run's per-attempt
 * {@link SampleResult}s. Pure and deterministic — the store calls this to fill a
 * record's `metrics`, and it is unit-tested independently of any run.
 *
 * Aggregation is a straight mean over attempts, computed both overall and per
 * `(task, length)` cell. Empty inputs yield zeroed metrics (no division by
 * zero), so a report never has to special-case an empty run.
 */

/** Mean of `values`, or 0 for an empty list. */
function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Compute one cell's metrics from the attempts that fall in it. */
function cellMetrics(
  task: Task,
  nominalLength: ContextLength,
  results: readonly SampleResult[],
): CellMetrics {
  return {
    task,
    nominalLength,
    attempts: results.length,
    accuracy: mean(results.map((r) => (r.passed ? 1 : 0))),
    meanScore: mean(results.map((r) => r.score)),
    meanInputTokens: mean(results.map((r) => r.metrics.inputTokens)),
    meanCachedInputTokens: mean(results.map((r) => r.metrics.cachedInputTokens)),
    meanOutputTokens: mean(results.map((r) => r.metrics.outputTokens)),
    meanPeakContextTokens: mean(results.map((r) => r.metrics.peakContextTokens)),
    meanTurns: mean(results.map((r) => r.metrics.turns)),
  };
}

/**
 * Aggregate all attempts into overall metrics plus a per-`(task, length)` cell
 * table. Cells are ordered by first appearance of the task, then by ascending
 * length, so a report renders them stably.
 */
function aggregate(results: readonly SampleResult[]): RunMetrics {
  // Group attempts by cell key, preserving insertion order.
  const cells = new Map<
    string,
    { task: Task; nominalLength: ContextLength; items: SampleResult[] }
  >();
  for (const result of results) {
    const key = `${result.task}/${result.nominalLength.toString()}`;
    const bucket = cells.get(key);
    if (bucket === undefined) {
      cells.set(key, {
        task: result.task,
        nominalLength: result.nominalLength,
        items: [result],
      });
    } else {
      bucket.items.push(result);
    }
  }

  const cellList = [...cells.values()].map((bucket) =>
    cellMetrics(bucket.task, bucket.nominalLength, bucket.items),
  );

  return {
    attempts: results.length,
    accuracy: mean(results.map((r) => (r.passed ? 1 : 0))),
    meanScore: mean(results.map((r) => r.score)),
    meanInputTokens: mean(results.map((r) => r.metrics.inputTokens)),
    meanOutputTokens: mean(results.map((r) => r.metrics.outputTokens)),
    cells: cellList,
  };
}

export { aggregate, mean };
