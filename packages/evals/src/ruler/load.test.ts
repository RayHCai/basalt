import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalConfigError } from '../errors.js';
import type { Sample } from '../task.js';
import { loadSamples, selectPrefix } from './load.js';

const FIXTURES = join(import.meta.dirname, '__fixtures__');

/** A throwaway sample for selectPrefix unit tests. */
function sample(index: number): Sample {
  return {
    id: `niah_single_1/8192/${index.toString()}`,
    task: 'niah_single_1',
    nominalLength: 8192,
    index,
    input: 'x',
    answers: ['a'],
    answerPrefix: '',
    inputTokens: 1,
  };
}

describe('selectPrefix', () => {
  it('takes ceil(n*fraction), at least 1', () => {
    const all = [sample(0), sample(1), sample(2), sample(3)];
    expect(selectPrefix(all, 0.5).map((s) => s.index)).toEqual([0, 1]);
    expect(selectPrefix(all, 0.01).map((s) => s.index)).toEqual([0]);
    expect(selectPrefix(all, 1)).toHaveLength(4);
  });

  it('clamps to maxSamplesPerTask', () => {
    const all = [sample(0), sample(1), sample(2), sample(3)];
    expect(selectPrefix(all, 1, 2).map((s) => s.index)).toEqual([0, 1]);
  });

  it('a smaller fraction is a strict prefix of a larger one', () => {
    const all = Array.from({ length: 10 }, (_, i) => sample(i));
    const half = selectPrefix(all, 0.5).map((s) => s.index);
    const full = selectPrefix(all, 1).map((s) => s.index);
    expect(full.slice(0, half.length)).toEqual(half);
  });

  it('returns [] for an empty file', () => {
    expect(selectPrefix([], 1)).toEqual([]);
  });
});

describe('loadSamples (against committed fixtures)', () => {
  it('loads the requested tasks and lengths from disk', async () => {
    const samples = await loadSamples({
      dataDir: FIXTURES,
      tasks: ['niah_single_1', 'qa_1'],
      lengths: [8192],
    });
    expect(samples).toHaveLength(5);
    expect(samples.filter((s) => s.task === 'niah_single_1')).toHaveLength(3);
    expect(samples.filter((s) => s.task === 'qa_1')).toHaveLength(2);
  });

  it('orders by task, then length, then file order', async () => {
    const samples = await loadSamples({
      dataDir: FIXTURES,
      tasks: ['niah_single_1', 'qa_1'],
      lengths: [8192],
    });
    expect(samples.map((s) => s.id).slice(0, 4)).toEqual([
      'niah_single_1/8192/0',
      'niah_single_1/8192/1',
      'niah_single_1/8192/2',
      'qa_1/8192/0',
    ]);
  });

  it('applies the fraction as a per-task prefix', async () => {
    const samples = await loadSamples({
      dataDir: FIXTURES,
      tasks: ['niah_single_1'],
      lengths: [8192],
      fraction: 0.34,
    });
    expect(samples.map((s) => s.index)).toEqual([0, 1]);
  });

  it('applies maxSamplesPerTask', async () => {
    const samples = await loadSamples({
      dataDir: FIXTURES,
      tasks: ['niah_single_1'],
      lengths: [8192],
      maxSamplesPerTask: 1,
    });
    expect(samples).toHaveLength(1);
  });

  it('rejects an out-of-range fraction', async () => {
    await expect(
      loadSamples({ dataDir: FIXTURES, tasks: ['niah_single_1'], lengths: [8192], fraction: 0 }),
    ).rejects.toBeInstanceOf(EvalConfigError);
    await expect(
      loadSamples({ dataDir: FIXTURES, tasks: ['niah_single_1'], lengths: [8192], fraction: 2 }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it('rejects a bad maxSamplesPerTask and empty task/length lists', async () => {
    await expect(
      loadSamples({ dataDir: FIXTURES, lengths: [8192], maxSamplesPerTask: 0 }),
    ).rejects.toBeInstanceOf(EvalConfigError);
    await expect(
      loadSamples({ dataDir: FIXTURES, tasks: [], lengths: [8192] }),
    ).rejects.toBeInstanceOf(EvalConfigError);
    await expect(
      loadSamples({ dataDir: FIXTURES, tasks: ['vt'], lengths: [] }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it('rejects when a requested dataset file is missing', async () => {
    await expect(
      loadSamples({ dataDir: FIXTURES, tasks: ['vt'], lengths: [8192] }),
    ).rejects.toThrow();
  });
});
