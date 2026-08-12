import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

import { getLogger } from '@basalt/observability';
import type { Logger } from '@basalt/observability';

import { EvalError } from './errors.js';
import { dataDir } from './paths.js';
import type { Env } from './paths.js';
import { loadTaskSamples } from './ruler/dataset.js';
import { TASKS } from './task.js';
import type { Task } from './task.js';
import { CONTEXT_LENGTHS } from './tokens.js';
import type { ContextLength } from './tokens.js';

/**
 * `basalt evaluate load` — populate the RULER datasets under
 * `<STATE_DIR>/evals/data` by running NVIDIA's real generators (via the
 * committed `scripts/generate-ruler-data.sh`), then VALIDATE the result by
 * loading every produced file back into {@link Sample}s.
 *
 * Generation is heavy and stateful (clones RULER, sets up a Python venv,
 * downloads corpora, then generates each task × length). It is intentionally
 * kept in the shell script — this module only DRIVES it: it points the script's
 * output at the config-managed state tree, streams its progress lines to a
 * callback (the CLI renders a spinner), and confirms the datasets are
 * loadable afterward.
 *
 * Both the child-process spawn and the script path are injectable so tests can
 * exercise the orchestration without cloning RULER or touching the network.
 */

/** How {@link loadData} launches the generator. Mirrors the bits of `spawn` used. */
type SpawnLike = typeof spawn;

/** Options for {@link loadData}. */
interface LoadDataOptions {
  /** Context lengths to generate. Defaults to all {@link CONTEXT_LENGTHS}. */
  lengths?: readonly ContextLength[];
  /** RULER tasks to generate. Defaults to all {@link TASKS}. */
  tasks?: readonly Task[];
  /** Samples to generate per `(task, length)`. Defaults to the script's default. */
  samples?: number;
  /** RNG seed passed to the generators. Defaults to the script's default. */
  seed?: number;
  /**
   * Called with each trimmed, non-empty progress line the generator emits (on
   * stdout or stderr). The CLI uses this to drive a spinner/status line.
   */
  onProgress?: (line: string) => void;
  /** Environment map (state-dir + dataset-dir resolution). Defaults to `process.env`. */
  env?: Env;
  /** Absolute path to `generate-ruler-data.sh`. Defaults to the repo copy. */
  scriptPath?: string;
  /** Child-process spawner. Defaults to `node:child_process`'s `spawn`. */
  spawnFn?: SpawnLike;
  /** Logger. Defaults to a subsystem logger tagged `evals`. */
  logger?: Logger;
}

/** What {@link loadData} produced. */
interface LoadDataResult {
  /** Absolute dataset root the data was written to (`<STATE_DIR>/evals/data`). */
  readonly dataDir: string;
  /** One entry per `(task, length)` loaded, with its sample count. */
  readonly loaded: readonly { task: Task; length: ContextLength; samples: number }[];
  /** Total samples across every loaded file. */
  readonly totalSamples: number;
}

/**
 * Resolve the committed generation script. From the compiled module
 * (`packages/evals/dist/data-load.js`) the repo root is three levels up; the
 * script lives at `<repo>/scripts/generate-ruler-data.sh`.
 */
function defaultScriptPath(): string {
  const here = import.meta.dirname;
  return resolvePath(here, '..', '..', '..', 'scripts', 'generate-ruler-data.sh');
}

/**
 * Run the generator to populate `<STATE_DIR>/evals/data`, then validate by
 * loading every requested `(task, length)` file. Rejects with {@link EvalError}
 * if the generator exits non-zero or a produced dataset fails to load.
 */
async function loadData(options: LoadDataOptions = {}): Promise<LoadDataResult> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? getLogger('evals');
  const lengths = options.lengths ?? CONTEXT_LENGTHS;
  const tasks = options.tasks ?? TASKS;
  const root = dataDir(env);
  const scriptPath = options.scriptPath ?? defaultScriptPath();
  const spawnFn = options.spawnFn ?? spawn;

  // The script reads its knobs from env vars (see its header). Point it at the
  // config-managed data dir and forward the selection.
  const scriptEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    RULER_DATA_DIR: root,
    RULER_LENGTHS: lengths.map((l) => l.toString()).join(' '),
    RULER_TASKS: tasks.join(' '),
    ...(options.samples === undefined ? {} : { RULER_SAMPLES: options.samples.toString() }),
    ...(options.seed === undefined ? {} : { RULER_SEED: options.seed.toString() }),
  };

  logger.info(
    { dataDir: root, tasks: tasks.length, lengths: lengths.length },
    'evaluate load: generating',
  );
  await runGenerator(scriptPath, scriptEnv, spawnFn, options.onProgress);

  // Validate: load every requested file back. A generation that "succeeded" but
  // produced an unreadable/empty file is a load failure, surfaced here.
  const loaded: { task: Task; length: ContextLength; samples: number }[] = [];
  let totalSamples = 0;
  for (const task of tasks) {
    for (const length of lengths) {
      // Sequential: small grid, and keeps validation deterministic + low-memory.
      // oxlint-disable-next-line no-await-in-loop
      const samples = await loadTaskSamples(root, task, length);
      if (samples.length === 0) {
        throw new EvalError(
          `evaluate load: produced no samples for ${task} at ${length.toString()}`,
        );
      }
      loaded.push({ task, length, samples: samples.length });
      totalSamples += samples.length;
    }
  }

  logger.info({ dataDir: root, files: loaded.length, totalSamples }, 'evaluate load: complete');
  return { dataDir: root, loaded, totalSamples };
}

/**
 * Spawn the generation script, forwarding its progress lines to `onProgress`.
 * Resolves when it exits 0; rejects with {@link EvalError} otherwise (or if the
 * process cannot be spawned at all).
 */
function runGenerator(
  scriptPath: string,
  scriptEnv: NodeJS.ProcessEnv,
  spawnFn: SpawnLike,
  onProgress: ((line: string) => void) | undefined,
): Promise<void> {
  // A raw Promise is the right tool here: it bridges the child process's
  // event-emitter callbacks (data/error/close) into an awaitable.
  // oxlint-disable-next-line promise/avoid-new
  return new Promise<void>((resolve, reject) => {
    const child = spawnFn('bash', [scriptPath], {
      env: scriptEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const emit = (chunk: Buffer | string): void => {
      if (onProgress === undefined) {
        return;
      }
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          onProgress(trimmed);
        }
      }
    };
    child.stdout?.on('data', emit);
    child.stderr?.on('data', emit);

    child.on('error', (error) => {
      reject(new EvalError(`evaluate load: could not run ${scriptPath}`, { cause: error }));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new EvalError(`evaluate load: generator exited with code ${String(code)}`));
      }
    });
  });
}

export { defaultScriptPath, loadData, type LoadDataOptions, type LoadDataResult, type SpawnLike };
