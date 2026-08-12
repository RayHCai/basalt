import { EventEmitter } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadData } from './data-load.js';
import type { SpawnLike } from './data-load.js';
import { EvalError } from './errors.js';

// oxlint-disable-next-line init-declarations
let dir: string;
// oxlint-disable-next-line init-declarations
let env: Record<string, string>;

beforeEach(async () => {
  dir = await mkdtempDir();
  env = { BASALT_STATE_DIR: dir };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkdtempDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'basalt-evals-load-'));
}

/** A synthetic RULER line, enough for the loader to accept. */
function jsonl(index: number): string {
  return `${JSON.stringify({ index, input: `find 12345${index.toString()}`, outputs: [`12345${index.toString()}`], length: 20 })}\n`;
}

/** A ChildProcess-shaped emitter triple (Node's EventEmitter — has `.emit`). */
type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

/**
 * Build a fake ChildProcess with its own stdout/stderr emitters. Uses Node's
 * EventEmitter (which has `.emit`, unlike EventTarget) because that is exactly
 * what `child_process.spawn` returns.
 */
/* oxlint-disable unicorn/prefer-event-target -- faking a Node ChildProcess, not a browser EventTarget */
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}
/* oxlint-enable unicorn/prefer-event-target */

/**
 * Build a fake `spawn` that, instead of running bash, writes the dataset files
 * the real generator would produce (into RULER_DATA_DIR), streams a couple of
 * progress lines, then exits `code`. Lets loadData's orchestration + validation
 * be tested with no clone/Python/network.
 */
function fakeSpawn(options: { code?: number; write?: boolean } = {}): SpawnLike {
  const code = options.code ?? 0;
  const write = options.write ?? true;

  return ((_cmd: string, _args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
    const child = fakeChild();

    // Yield a microtask so loadData attaches its listeners before we emit
    // (a real child_process.spawn emits asynchronously, never synchronously).
    void (async (): Promise<void> => {
      await Promise.resolve();
      child.stdout.emit('data', Buffer.from('==> cloning\n==> generating 8192/niah_single_1\n'));
      if (write) {
        const root = opts.env?.['RULER_DATA_DIR'] ?? '';
        const taskDir = join(root, '8192', 'niah_single_1');
        await mkdir(taskDir, { recursive: true });
        await writeFile(join(taskDir, 'validation.jsonl'), jsonl(0) + jsonl(1));
      }
      child.emit('close', code);
    })();

    return child;
  }) as unknown as SpawnLike;
}

describe('loadData', () => {
  it('generates + validates a single (task, length) and reports counts', async () => {
    const spawnFn = fakeSpawn();
    const lines: string[] = [];
    const result = await loadData({
      env,
      tasks: ['niah_single_1'],
      lengths: [8192],
      spawnFn,
      scriptPath: '/fake/generate.sh',
      onProgress: (line) => lines.push(line),
    });

    expect(result.dataDir).toBe(join(dir, 'evals', 'data'));
    expect(result.loaded).toEqual([{ task: 'niah_single_1', length: 8192, samples: 2 }]);
    expect(result.totalSamples).toBe(2);
    // Progress lines were streamed to the callback.
    expect(lines).toContain('==> cloning');
    expect(lines).toContain('==> generating 8192/niah_single_1');
  });

  it('passes the state-dir data path + selection to the generator via env', async () => {
    // oxlint-disable-next-line init-declarations
    let seenEnv: NodeJS.ProcessEnv | undefined;
    const spawnFn = ((
      _cmd: string,
      _args: readonly string[],
      opts: { env?: NodeJS.ProcessEnv },
    ) => {
      seenEnv = opts.env;
      const child = fakeChild();
      void (async (): Promise<void> => {
        await Promise.resolve();
        const root = opts.env?.['RULER_DATA_DIR'] ?? '';
        const taskDir = join(root, '8192', 'vt');
        await mkdir(taskDir, { recursive: true });
        await writeFile(join(taskDir, 'validation.jsonl'), jsonl(0));
        child.emit('close', 0);
      })();
      return child;
    }) as unknown as SpawnLike;

    await loadData({ env, tasks: ['vt'], lengths: [8192], samples: 5, seed: 7, spawnFn });

    expect(seenEnv?.['RULER_DATA_DIR']).toBe(join(dir, 'evals', 'data'));
    expect(seenEnv?.['RULER_TASKS']).toBe('vt');
    expect(seenEnv?.['RULER_LENGTHS']).toBe('8192');
    expect(seenEnv?.['RULER_SAMPLES']).toBe('5');
    expect(seenEnv?.['RULER_SEED']).toBe('7');
  });

  it('rejects when the generator exits non-zero', async () => {
    const spawnFn = fakeSpawn({ code: 1, write: false });
    await expect(
      loadData({ env, tasks: ['niah_single_1'], lengths: [8192], spawnFn }),
    ).rejects.toBeInstanceOf(EvalError);
  });

  it('rejects when generation produced no samples for a requested file', async () => {
    // Exits 0 but writes nothing → validation must fail loudly.
    const spawnFn = fakeSpawn({ code: 0, write: false });
    await expect(
      loadData({ env, tasks: ['niah_single_1'], lengths: [8192], spawnFn }),
    ).rejects.toBeInstanceOf(EvalError);
  });

  it('rejects when the process cannot be spawned', async () => {
    const spawnFn = (() => {
      const child = fakeChild();
      void (async (): Promise<void> => {
        await Promise.resolve();
        child.emit('error', new Error('bash not found'));
      })();
      return child;
    }) as unknown as SpawnLike;
    await expect(
      loadData({ env, tasks: ['niah_single_1'], lengths: [8192], spawnFn }),
    ).rejects.toThrow(/could not run/u);
  });
});
