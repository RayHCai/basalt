import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EvalResultError } from './errors.js';
import type { RunRecord } from './record.js';
import { isRunRecord, listRuns, loadAllRuns, loadRun, saveRun } from './store.js';

// oxlint-disable-next-line init-declarations
let dir: string;
// oxlint-disable-next-line init-declarations
let env: Record<string, string>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-evals-store-'));
  env = { BASALT_STATE_DIR: dir };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function record(runId: string): RunRecord {
  return {
    version: 1,
    runId,
    createdAt: '2026-07-12T17:41:12.000Z',
    params: {
      fraction: 1,
      lengths: [8192],
      tasks: ['niah_single_1'],
      maxSamplesPerTask: null,
      reps: 1,
      temperature: 0,
      maxInputTokens: null,
      maxTurns: null,
      provider: 'dummy',
      model: 'dummy-model',
    },
    results: [],
    metrics: {
      attempts: 0,
      accuracy: 0,
      meanScore: 0,
      meanInputTokens: 0,
      meanOutputTokens: 0,
      cells: [],
    },
  };
}

describe('saveRun / loadRun', () => {
  it('round-trips a record', async () => {
    const path = await saveRun(record('run-1'), { env });
    expect(path).toBe(join(dir, 'evals', 'results', 'run-1.json'));
    const loaded = await loadRun('run-1', { env });
    expect(loaded.runId).toBe('run-1');
    expect(loaded.params.provider).toBe('dummy');
  });

  it('writes owner-only, pretty-printed JSON', async () => {
    const path = await saveRun(record('run-2'), { env });
    const text = await readFile(path, 'utf8');
    expect(text).toContain('\n  "runId": "run-2"');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('rejects a path-traversal run id', async () => {
    await expect(saveRun(record('../escape'), { env })).rejects.toThrow();
    await expect(loadRun('../escape', { env })).rejects.toThrow();
  });

  it('throws EvalResultError for a missing run', async () => {
    await expect(loadRun('nope', { env })).rejects.toBeInstanceOf(EvalResultError);
  });

  it('throws EvalResultError for malformed JSON', async () => {
    const resultsDirPath = join(dir, 'evals', 'results');
    // save a good record first to create the results directory
    await saveRun(record('good'), { env });
    await writeFile(join(resultsDirPath, 'bad.json'), '{ not json', 'utf8');
    await expect(loadRun('bad', { env })).rejects.toBeInstanceOf(EvalResultError);
  });
});

describe('listRuns / loadAllRuns', () => {
  it('lists ids ascending and tolerates a missing dir', async () => {
    expect(await listRuns({ env })).toEqual([]);
    await saveRun(record('run-b'), { env });
    await saveRun(record('run-a'), { env });
    expect(await listRuns({ env })).toEqual(['run-a', 'run-b']);
  });

  it('loads all records ascending', async () => {
    await saveRun(record('run-b'), { env });
    await saveRun(record('run-a'), { env });
    const all = await loadAllRuns({ env });
    expect(all.map((r) => r.runId)).toEqual(['run-a', 'run-b']);
  });
});

describe('isRunRecord', () => {
  it('accepts a well-formed record and rejects junk', () => {
    expect(isRunRecord(record('x'))).toBe(true);
    expect(isRunRecord({})).toBe(false);
    expect(isRunRecord(null)).toBe(false);
    expect(isRunRecord({ version: 2, runId: 'x' })).toBe(false);
  });
});
