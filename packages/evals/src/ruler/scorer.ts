import type { Sample } from '../task.js';
import { TASK_METRIC } from '../task.js';

/**
 * RULER scoring, ported VERBATIM from RULER's
 * `scripts/eval/synthetic/constants.py`:
 *
 * ```python
 * def string_match_part(preds, refs):
 *     score = sum([max([1.0 if r.lower() in pred.lower() else 0.0 for r in ref])
 *                  for pred, ref in zip(preds, refs)]) / len(preds) * 100
 *
 * def string_match_all(preds, refs):
 *     score = sum([sum([1.0 if r.lower() in pred.lower() else 0.0 for r in ref]) / len(ref)
 *                  for pred, ref in zip(preds, refs)]) / len(preds) * 100
 * ```
 *
 * Matching is a plain case-insensitive SUBSTRING test (`r.lower() in
 * pred.lower()`) — no tokenization, no punctuation stripping. Per sample:
 *  - `string_match_part` (QA tasks) → 1 if ANY reference is present, else 0.
 *  - `string_match_all` (all other tasks) → fraction of references present.
 *
 * RULER reports the mean × 100 across a dataset; here we grade ONE output at a
 * time and return the per-sample fraction in `[0, 1]` (the runner/aggregate do
 * the averaging). A task's metric is looked up from {@link TASK_METRIC}.
 */

/** The graded outcome for one output against one sample. */
interface Score {
  /** Per-sample score in `[0, 1]`: recall (all) or hit (part). */
  readonly score: number;
  /** Whether {@link score} meets the pass threshold (full credit). */
  readonly passed: boolean;
  /** How many reference answers were found in the output. */
  readonly matched: number;
  /** Total reference answers. */
  readonly total: number;
}

/**
 * The pass threshold on the per-sample score. RULER itself reports a continuous
 * mean and has no notion of per-sample pass/fail; we define "passed" as full
 * credit (score === 1) so the report can show an accuracy alongside mean score.
 * A single constant (not per-task) keeps this transparent.
 */
const PASS_THRESHOLD = 1;

/** RULER's `r.lower() in pred.lower()`: case-insensitive substring presence. */
function referencePresent(output: string, reference: string): boolean {
  return output.toLowerCase().includes(reference.toLowerCase());
}

/** Count how many of `answers` are present in `output` (each a substring test). */
function countMatches(output: string, answers: readonly string[]): number {
  let matched = 0;
  for (const answer of answers) {
    if (referencePresent(output, answer)) {
      matched += 1;
    }
  }
  return matched;
}

/**
 * Score `output` against `sample` using the sample task's RULER metric:
 *  - `string_match_all` → `matched / total` (recall).
 *  - `string_match_part` → `1` if `matched > 0` else `0` (any hit).
 * An empty reference set scores 0 (avoids division by zero; a well-formed RULER
 * sample always has at least one reference).
 */
function scoreOutput(sample: Sample, output: string): Score {
  const total = sample.answers.length;
  const matched = countMatches(output, sample.answers);

  // oxlint-disable-next-line init-declarations
  let score: number;
  if (total === 0) {
    score = 0;
  } else if (TASK_METRIC[sample.task] === 'string_match_part') {
    score = matched > 0 ? 1 : 0;
  } else {
    score = matched / total;
  }

  return { score, passed: score >= PASS_THRESHOLD, matched, total };
}

export { countMatches, PASS_THRESHOLD, referencePresent, type Score, scoreOutput };
