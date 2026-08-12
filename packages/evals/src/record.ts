import type { SampleResult, Task } from './task.js';
import type { ContextLength } from './tokens.js';

/**
 * The persisted shape of one completed eval run: enough to reproduce, plot, and
 * tabulate it without re-running. Written to
 * `<STATE_DIR>/evaluation-results/<runId>.json` by the store, read back by the
 * report.
 *
 * A run record is self-describing: it carries the parameters it was produced
 * with (so a report can label the series and a future run can reproduce it), the
 * per-attempt {@link SampleResult}s, and the derived aggregate {@link RunMetrics}.
 */

/** The parameters a run was executed with (echoed into the record for provenance). */
interface RunParams {
  /** Fraction of each task's samples that were run, in `(0, 1]`. */
  readonly fraction: number;
  /** Nominal context lengths the run covered. */
  readonly lengths: readonly ContextLength[];
  /** RULER tasks the run covered. */
  readonly tasks: readonly Task[];
  /** Max samples taken per `(task, length)`, or `null` for all available. */
  readonly maxSamplesPerTask: number | null;
  /** Repetitions per sample (all at temperature 0). */
  readonly reps: number;
  /** Sampling temperature (0 for the reproducible bring-up). */
  readonly temperature: number;
  /** Per-attempt input-token cap, or `null` for uncapped. */
  readonly maxInputTokens: number | null;
  /** Per-attempt turn cap, or `null` for uncapped. */
  readonly maxTurns: number | null;
  /** Provider name the run targeted (e.g. `dummy`). */
  readonly provider: string;
  /** Model identifier the run targeted (e.g. `dummy-model`). */
  readonly model: string;
}

/** One `(task, length)` cell of the aggregate metric table. */
interface CellMetrics {
  /** The task this cell aggregates. */
  readonly task: Task;
  /** The nominal context length this cell aggregates. */
  readonly nominalLength: ContextLength;
  /** Number of graded attempts in the cell. */
  readonly attempts: number;
  /** Fraction of attempts that passed, in `[0, 1]`. */
  readonly accuracy: number;
  /** Mean recall score across attempts, in `[0, 1]`. */
  readonly meanScore: number;
  /** Mean input tokens per attempt. */
  readonly meanInputTokens: number;
  /** Mean cached input tokens per attempt. */
  readonly meanCachedInputTokens: number;
  /** Mean output tokens per attempt. */
  readonly meanOutputTokens: number;
  /** Mean peak context tokens per attempt. */
  readonly meanPeakContextTokens: number;
  /** Mean agent turns per attempt. */
  readonly meanTurns: number;
}

/** Run-wide aggregate metrics: an overall summary plus the per-cell table. */
interface RunMetrics {
  /** Total graded attempts (`samples × reps`). */
  readonly attempts: number;
  /** Overall pass rate across all attempts, in `[0, 1]`. */
  readonly accuracy: number;
  /** Overall mean recall score across all attempts, in `[0, 1]`. */
  readonly meanScore: number;
  /** Mean input tokens per attempt across the whole run. */
  readonly meanInputTokens: number;
  /** Mean output tokens per attempt across the whole run. */
  readonly meanOutputTokens: number;
  /** Per-`(task, length)` breakdown, one {@link CellMetrics} each. */
  readonly cells: readonly CellMetrics[];
}

/** A fully persisted eval run. */
interface RunRecord {
  /** Schema version, so a future format change can be detected on read. */
  readonly version: 1;
  /** Unique, sortable run identifier (timestamped slug). */
  readonly runId: string;
  /** ISO-8601 timestamp the run completed (stamped by the store). */
  readonly createdAt: string;
  /** The parameters the run was executed with. */
  readonly params: RunParams;
  /** Every graded attempt, in execution order. */
  readonly results: readonly SampleResult[];
  /** Derived aggregate metrics. */
  readonly metrics: RunMetrics;
}

export type { CellMetrics, RunMetrics, RunParams, RunRecord };
