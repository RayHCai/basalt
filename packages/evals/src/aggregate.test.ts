import { describe, expect, it } from 'vitest';

import { aggregate, mean } from './aggregate.js';
import type { SampleMetrics, SampleResult } from './task.js';

function metrics(overrides: Partial<SampleMetrics> = {}): SampleMetrics {
  return {
    inputTokens: 8192,
    cachedInputTokens: 0,
    uncachedInputTokens: 8192,
    outputTokens: 1,
    peakContextTokens: 8193,
    turns: 1,
    durationMs: 10,
    ...overrides,
  };
}

function result(overrides: Partial<SampleResult> = {}): SampleResult {
  return {
    sampleId: 'niah_single_1/8192/0',
    task: 'niah_single_1',
    nominalLength: 8192,
    rep: 0,
    output: 'test',
    passed: false,
    score: 0,
    metrics: metrics(),
    ...overrides,
  };
}

describe('mean', () => {
  it('averages a list and returns 0 for empty', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
  });
});

describe('aggregate', () => {
  it('zeroes metrics for an empty run without dividing by zero', () => {
    const m = aggregate([]);
    expect(m.attempts).toBe(0);
    expect(m.accuracy).toBe(0);
    expect(m.meanScore).toBe(0);
    expect(m.cells).toEqual([]);
  });

  it('computes overall accuracy and mean score', () => {
    const results = [
      result({ passed: true, score: 1 }),
      result({ passed: false, score: 0 }),
      result({ passed: true, score: 1 }),
      result({ passed: false, score: 0.5 }),
    ];
    const m = aggregate(results);
    expect(m.attempts).toBe(4);
    expect(m.accuracy).toBe(0.5);
    expect(m.meanScore).toBe(0.625);
  });

  it('breaks metrics down per (task, length) cell', () => {
    const results = [
      result({ task: 'niah_single_1', nominalLength: 8192, passed: true, score: 1 }),
      result({ task: 'niah_single_1', nominalLength: 32_768, passed: false, score: 0 }),
      result({ task: 'vt', nominalLength: 8192, passed: true, score: 1 }),
    ];
    const m = aggregate(results);
    expect(m.cells).toHaveLength(3);
    const cell = m.cells.find((c) => c.task === 'niah_single_1' && c.nominalLength === 8192);
    expect(cell?.accuracy).toBe(1);
    expect(cell?.attempts).toBe(1);
  });

  it('averages token metrics per cell', () => {
    const results = [
      result({ metrics: metrics({ inputTokens: 8000, outputTokens: 10 }) }),
      result({ metrics: metrics({ inputTokens: 8400, outputTokens: 20 }) }),
    ];
    const m = aggregate(results);
    expect(m.meanInputTokens).toBe(8200);
    expect(m.meanOutputTokens).toBe(15);
    expect(m.cells[0]?.meanInputTokens).toBe(8200);
  });
});
