import { readFile } from 'node:fs/promises';

import { EvalResultError } from '../errors.js';
import { taskFile } from '../paths.js';
import type { Sample, Task } from '../task.js';
import type { ContextLength } from '../tokens.js';

/**
 * Read RULER `.jsonl` dataset files (produced by `scripts/generate-ruler-data.sh`
 * running NVIDIA's real generators) into {@link Sample}s. This is the ONLY place
 * that knows RULER's on-disk line format; everything downstream sees `Sample`s.
 *
 * A RULER line looks like:
 * ```jsonc
 * { "index": 17554, "input": "…prompt…", "outputs": ["3094235"],
 *   "length": 8173, "answer_prefix": " The special magic number … is" }
 * ```
 * Files live at `<root>/<nominalLength>/<task>/validation.jsonl`.
 */

/** The subset of a RULER jsonl line this loader depends on. */
interface RulerLine {
  index: number;
  input: string;
  outputs: string[];
  length?: number;
  answer_prefix?: string;
}

/** Read + parse one task's dataset file into {@link Sample}s (empty file → `[]`). */
async function loadTaskSamples(
  root: string,
  task: Task,
  nominalLength: ContextLength,
): Promise<Sample[]> {
  const path = taskFile(root, nominalLength, task);
  // oxlint-disable-next-line init-declarations
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new EvalResultError(
        `RULER dataset missing: ${path}. Run \`scripts/generate-ruler-data.sh\` first.`,
        { cause: error },
      );
    }
    throw new EvalResultError(`Could not read RULER dataset at ${path}`, { cause: error });
  }
  return parseJsonl(text, path, task, nominalLength);
}

/** Parse RULER jsonl `text` into {@link Sample}s, tolerating blank trailing lines. */
function parseJsonl(
  text: string,
  path: string,
  task: Task,
  nominalLength: ContextLength,
): Sample[] {
  // Keep each line's original 1-based number for error messages, then drop the
  // blanks (RULER files end with a trailing newline).
  const numbered = text.split('\n').map((raw, i) => ({ line: raw.trim(), lineNumber: i + 1 }));
  return numbered
    .filter((entry) => entry.line.length > 0)
    .map(({ line, lineNumber }) => {
      // oxlint-disable-next-line init-declarations
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new EvalResultError(`Malformed RULER line ${lineNumber.toString()} in ${path}`, {
          cause: error,
        });
      }
      return toSample(parsed, path, task, nominalLength);
    });
}

/** Convert one validated RULER line into a {@link Sample}. */
function toSample(value: unknown, path: string, task: Task, nominalLength: ContextLength): Sample {
  if (!isRulerLine(value)) {
    throw new EvalResultError(
      `RULER line in ${path} is missing required fields (index/input/outputs)`,
    );
  }
  const answerPrefix = value.answer_prefix ?? '';
  // RULER's `length` is the real cl100k_base token count; fall back to the
  // nominal bucket length only if the field is absent.
  const inputTokens = typeof value.length === 'number' ? value.length : nominalLength;
  return {
    id: `${task}/${nominalLength.toString()}/${value.index.toString()}`,
    task,
    nominalLength,
    index: value.index,
    input: value.input,
    answers: value.outputs,
    answerPrefix,
    inputTokens,
  };
}

/** Structural guard for a RULER jsonl line (the fields this loader needs). */
function isRulerLine(value: unknown): value is RulerLine {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const line = value as Record<string, unknown>;
  return (
    typeof line['index'] === 'number' &&
    typeof line['input'] === 'string' &&
    Array.isArray(line['outputs']) &&
    line['outputs'].every((answer) => typeof answer === 'string')
  );
}

export { isRulerLine, loadTaskSamples, parseJsonl, type RulerLine };
