import type { ContextLength } from './tokens.js';

/**
 * The core domain vocabulary of the eval system, shared by dataset loading,
 * scoring, instrumentation, the runner, and the store. Kept in one module so the
 * dependency graph fans out from a single type source (no cycles).
 *
 * Basalt does NOT generate RULER data itself — the real NVIDIA/RULER generators
 * are run once (see `scripts/generate-ruler-data.sh`) to emit `.jsonl`, and this
 * package LOADS those files. So the vocabulary mirrors RULER's own task set and
 * scoring, not a reimplementation.
 */

/**
 * The 13 RULER v1 TASKS (from RULER's `scripts/synthetic.yaml`), grouped by the
 * skill each exercises:
 *
 *  Retrieval (needle-in-a-haystack):
 *   - `niah_single_1/2/3` — one `key: value` needle (noise/essay haystack,
 *     numeric or UUID value).
 *   - `niah_multikey_1/2/3` — the needle competes with distractor keys.
 *   - `niah_multivalue` — one key maps to several values; recover all.
 *   - `niah_multiquery` — one key, several queries in one prompt.
 *  Multi-hop tracing:
 *   - `vt` — variable tracking: resolve chains of `X = Y` assignments.
 *  Aggregation:
 *   - `cwe` — common-words extraction (the N most frequent planted words).
 *   - `fwe` — frequent-words extraction (Zipfian coded-word frequencies).
 *  Question answering (needle-style over real corpora):
 *   - `qa_1` — SQuAD; `qa_2` — HotpotQA.
 */
const TASKS = [
  'niah_single_1',
  'niah_single_2',
  'niah_single_3',
  'niah_multikey_1',
  'niah_multikey_2',
  'niah_multikey_3',
  'niah_multivalue',
  'niah_multiquery',
  'vt',
  'cwe',
  'fwe',
  'qa_1',
  'qa_2',
] as const;

/** One RULER task name. */
type Task = (typeof TASKS)[number];

/**
 * Which RULER scorer a task is graded by (from RULER's
 * `scripts/eval/synthetic/constants.py`): every task uses `string_match_all`
 * except the QA tasks, which use `string_match_part`. See `ruler/scorer.ts`.
 */
type Metric = 'string_match_all' | 'string_match_part';

/** The RULER scorer each task is graded by. */
const TASK_METRIC: Readonly<Record<Task, Metric>> = {
  niah_single_1: 'string_match_all',
  niah_single_2: 'string_match_all',
  niah_single_3: 'string_match_all',
  niah_multikey_1: 'string_match_all',
  niah_multikey_2: 'string_match_all',
  niah_multikey_3: 'string_match_all',
  niah_multivalue: 'string_match_all',
  niah_multiquery: 'string_match_all',
  vt: 'string_match_all',
  cwe: 'string_match_all',
  fwe: 'string_match_all',
  qa_1: 'string_match_part',
  qa_2: 'string_match_part',
};

/** Type guard: `value` is a known RULER {@link Task}. */
function isTask(value: string): value is Task {
  return (TASKS as readonly string[]).includes(value);
}

/**
 * A single evaluation instance loaded from a RULER `.jsonl` file: the rendered
 * prompt plus the reference answer(s) its scorer grades a model output against.
 * Fields map directly onto RULER's line format (`index`, `input`, `outputs`,
 * `length`) plus the `task`/`nominalLength` we recover from the file's location.
 */
interface Sample {
  /**
   * Stable, unique identifier: `<task>/<nominalLength>/<index>` (e.g.
   * `niah_single_1/8192/17554`). Uses RULER's own per-line `index` (not a
   * positional counter), so the id survives regeneration/subsetting.
   */
  readonly id: string;
  /** The RULER task this sample instantiates. */
  readonly task: Task;
  /** The nominal context length (tokens) the dataset dir is bucketed under. */
  readonly nominalLength: ContextLength;
  /** RULER's own per-line index within its `(task, length)` file. */
  readonly index: number;
  /** The full prompt sent to the agent (RULER's `input`, sans answer prefix). */
  readonly input: string;
  /**
   * The reference answer(s) — RULER's `outputs` array, graded by the task's
   * {@link Metric}. Single-answer tasks carry one; multivalue/cwe/fwe carry
   * several; QA carries the accepted answer set.
   */
  readonly answers: readonly string[];
  /**
   * RULER's answer prefix for this sample (the text a base model's completion is
   * expected to continue), preserved for provenance. Not part of `input`.
   */
  readonly answerPrefix: string;
  /**
   * RULER's measured token length of the sample (`length` field), sized with the
   * `cl100k_base` tokenizer at generation time. Recorded so the report can plot
   * accuracy against real prompt size.
   */
  readonly inputTokens: number;
}

/**
 * Per-sample execution instrumentation — the measurements the report plots and
 * tabulates. Every field is a COUNT the runner observed for one graded attempt;
 * token fields fall back to the generation-time length when a provider (the
 * dummy) reports no real usage.
 */
interface SampleMetrics {
  /** Total input (prompt) tokens the model consumed. */
  readonly inputTokens: number;
  /** Input tokens served from cache (0 when the provider reports no cache stats). */
  readonly cachedInputTokens: number;
  /** Input tokens NOT served from cache (`inputTokens − cachedInputTokens`). */
  readonly uncachedInputTokens: number;
  /** Output (completion) tokens the model produced. */
  readonly outputTokens: number;
  /** The largest single-turn context (input + output) observed during the attempt. */
  readonly peakContextTokens: number;
  /** Number of agent turns taken (1 for the straight-through dummy path). */
  readonly turns: number;
  /** Wall-clock milliseconds the attempt took. */
  readonly durationMs: number;
}

/**
 * One graded attempt at one sample: the model's output, whether the scorer
 * passed it, the numeric score, and the instrumentation. A sample run `reps`
 * times yields `reps` of these.
 */
interface SampleResult {
  /** The sample this result is for. */
  readonly sampleId: string;
  /** The task (denormalized for grouping without a sample lookup). */
  readonly task: Task;
  /** The nominal context length (denormalized for grouping). */
  readonly nominalLength: ContextLength;
  /** Repetition index (0-based) within the sample's `reps`. */
  readonly rep: number;
  /** The raw text the agent returned. */
  readonly output: string;
  /** Whether the scorer judged the output correct (`score >= pass threshold`). */
  readonly passed: boolean;
  /** The scorer's numeric score in `[0, 1]` (recall fraction). */
  readonly score: number;
  /** Instrumentation for this attempt. */
  readonly metrics: SampleMetrics;
  /**
   * Set when the attempt failed to execute (provider/harness error, or a cap was
   * hit) rather than merely scoring 0. `undefined` on a normal graded attempt.
   */
  readonly error?: string;
}

export {
  isTask,
  type Metric,
  type Sample,
  type SampleMetrics,
  type SampleResult,
  type Task,
  TASK_METRIC,
  TASKS,
};
