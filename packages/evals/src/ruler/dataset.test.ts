import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalResultError } from '../errors.js';
import { isRulerLine, loadTaskSamples, parseJsonl } from './dataset.js';

// Committed, synthetic RULER-shaped fixtures (no third-party corpora), so the
// loader is tested hermetically without the generated .ruler-data present.
const FIXTURES = join(import.meta.dirname, '__fixtures__');

describe('loadTaskSamples', () => {
  it('loads a real RULER-shaped jsonl into Samples', async () => {
    const samples = await loadTaskSamples(FIXTURES, 'niah_single_1', 8192);
    expect(samples).toHaveLength(3);
    const [first] = samples;
    expect(first?.id).toBe('niah_single_1/8192/0');
    expect(first?.task).toBe('niah_single_1');
    expect(first?.nominalLength).toBe(8192);
    expect(first?.index).toBe(0);
    expect(first?.answers).toEqual(['314159']);
    // 42 is RULER's own `length` field for this fixture line.
    expect(first?.inputTokens).toBe(42);
    expect(first?.input).toContain('314159');
    expect(first?.answerPrefix).toContain('azure-falcon');
  });

  it('uses RULER per-line index in the id (not a positional counter)', async () => {
    const samples = await loadTaskSamples(FIXTURES, 'niah_single_1', 8192);
    expect(samples.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('carries multi-answer outputs (qa accepts several)', async () => {
    const samples = await loadTaskSamples(FIXTURES, 'qa_1', 8192);
    expect(samples[1]?.answers).toEqual(['Harvestmoon', 'the month of Harvestmoon']);
  });

  it('throws a clear EvalResultError when the dataset is missing', async () => {
    await expect(loadTaskSamples(FIXTURES, 'vt', 8192)).rejects.toBeInstanceOf(EvalResultError);
    await expect(loadTaskSamples(FIXTURES, 'vt', 8192)).rejects.toThrow(/generate-ruler-data/u);
  });
});

describe('parseJsonl', () => {
  it('tolerates blank trailing lines', () => {
    const text = '{"index":0,"input":"x","outputs":["a"],"length":1}\n\n';
    const samples = parseJsonl(text, 'p', 'vt', 8192);
    expect(samples).toHaveLength(1);
  });

  it('falls back to nominalLength when the length field is absent', () => {
    const text = '{"index":0,"input":"x","outputs":["a"]}';
    const samples = parseJsonl(text, 'p', 'vt', 8192);
    expect(samples[0]?.inputTokens).toBe(8192);
  });

  it('throws on a malformed line', () => {
    expect(() => parseJsonl('{ not json', 'p', 'vt', 8192)).toThrow(EvalResultError);
  });

  it('throws when required fields are missing', () => {
    expect(() => parseJsonl('{"index":0}', 'p', 'vt', 8192)).toThrow(EvalResultError);
  });
});

describe('isRulerLine', () => {
  it('accepts a well-formed line and rejects junk', () => {
    expect(isRulerLine({ index: 0, input: 'x', outputs: ['a'] })).toBe(true);
    expect(isRulerLine({ index: 0, input: 'x', outputs: [1] })).toBe(false);
    expect(isRulerLine({ index: 0, input: 'x' })).toBe(false);
    expect(isRulerLine(null)).toBe(false);
  });
});
