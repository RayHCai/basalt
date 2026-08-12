import { EvalConfigError } from '../errors.js';
import { dataDir as defaultDataDir } from '../paths.js';
import type { Env } from '../paths.js';
import { TASKS } from '../task.js';
import type { Sample, Task } from '../task.js';
import { CONTEXT_LENGTHS } from '../tokens.js';
import type { ContextLength } from '../tokens.js';
import { loadTaskSamples } from './dataset.js';

/**
 * Select the RULER samples an eval run will execute, by LOADING the datasets
 * that `scripts/generate-ruler-data.sh` produced (Basalt does not generate them).
 *
 * For each `(task, length)` the loader reads the corresponding
 * `validation.jsonl` and takes a DETERMINISTIC prefix of its lines: the
 * `fraction` parameter (the CLI's "percentage of total tasks") keeps the first
 * ⌈n×fraction⌉ samples of each file, and `maxSamplesPerTask` optionally caps the
 * count. Because files are ordered, a smaller fraction is always a strict subset
 * of a larger one — runs stay comparable.
 */

/** Parameters controlling which samples {@link loadSamples} selects. */
interface LoadOptions {
  /**
   * Fraction of each task's available samples to run, in `(0, 1]`. Keeps the
   * first ⌈n×fraction⌉ lines of each file (rounded UP so a non-zero fraction runs
   * at least one). Defaults to `1` (all available).
   */
  fraction?: number;
  /** Context lengths to include. Defaults to all {@link CONTEXT_LENGTHS}. */
  lengths?: readonly ContextLength[];
  /** RULER tasks to include. Defaults to all {@link TASKS}. */
  tasks?: readonly Task[];
  /**
   * Hard cap on samples taken per `(task, length)` file, applied AFTER `fraction`.
   * `undefined` (default) means no cap beyond what `fraction` selects.
   */
  maxSamplesPerTask?: number;
  /** Dataset root. Defaults to `<STATE_DIR>/evals/data` (or the env override). */
  dataDir?: string;
  /** Environment map (dataset-dir resolution). Defaults to `process.env`. */
  env?: Env;
}

/**
 * Load + select the samples. Validates parameters up front (throwing
 * {@link EvalConfigError}), then reads each `(task, length)` file and keeps its
 * deterministic prefix. Resolves to samples grouped by task, then length, then
 * file order. Rejects (via the loader) if a requested dataset file is missing.
 */
async function loadSamples(options: LoadOptions = {}): Promise<Sample[]> {
  const fraction = options.fraction ?? 1;
  const lengths = options.lengths ?? CONTEXT_LENGTHS;
  const tasks = options.tasks ?? TASKS;
  const root = options.dataDir ?? defaultDataDir(options.env);

  if (!(fraction > 0 && fraction <= 1)) {
    throw new EvalConfigError(`Task fraction must be in (0, 1]; got ${fraction.toString()}.`);
  }
  if (options.maxSamplesPerTask !== undefined) {
    const cap = options.maxSamplesPerTask;
    if (!Number.isInteger(cap) || cap < 1) {
      throw new EvalConfigError(
        `maxSamplesPerTask must be a positive integer; got ${cap.toString()}.`,
      );
    }
  }
  if (lengths.length === 0) {
    throw new EvalConfigError('At least one context length is required.');
  }
  if (tasks.length === 0) {
    throw new EvalConfigError('At least one task is required.');
  }

  const selected: Sample[] = [];
  for (const task of tasks) {
    for (const length of lengths) {
      // Sequential file reads: the grid is small (≤13×3) and this keeps the
      // deterministic task→length→index ordering the report and tests rely on.
      // oxlint-disable-next-line no-await-in-loop
      const all = await loadTaskSamples(root, task, length);
      selected.push(...selectPrefix(all, fraction, options.maxSamplesPerTask));
    }
  }
  return selected;
}

/**
 * Take the deterministic prefix of `samples`: ⌈n×fraction⌉ (at least 1 when the
 * file is non-empty), then clamp to `maxSamplesPerTask` if given.
 */
function selectPrefix(
  samples: readonly Sample[],
  fraction: number,
  maxSamplesPerTask?: number,
): Sample[] {
  if (samples.length === 0) {
    return [];
  }
  let count = Math.max(1, Math.ceil(samples.length * fraction));
  if (maxSamplesPerTask !== undefined) {
    count = Math.min(count, maxSamplesPerTask);
  }
  return samples.slice(0, count);
}

export { type LoadOptions, loadSamples, selectPrefix };
