import { describe, expect, it } from 'vitest';

import { computeMetrics, runInstrumented } from './instrument.js';
import type { Attempt } from './instrument.js';
import type { Sample } from './task.js';

function sample(inputTokens = 8192): Sample {
  return {
    id: 'niah_single_1/8192/0',
    task: 'niah_single_1',
    nominalLength: 8192,
    index: 0,
    input: 'x'.repeat(inputTokens * 4),
    answers: ['123456'],
    answerPrefix: '',
    inputTokens,
  };
}

describe('computeMetrics', () => {
  it('falls back to estimates when the provider reports no usage (dummy path)', () => {
    const attempt: Attempt = { output: 'test' };
    const metrics = computeMetrics(sample(8192), attempt, 12);
    expect(metrics.inputTokens).toBe(8192);
    expect(metrics.cachedInputTokens).toBe(0);
    expect(metrics.uncachedInputTokens).toBe(8192);
    // "test" → ceil(4/4) = 1 token
    expect(metrics.outputTokens).toBe(1);
    expect(metrics.peakContextTokens).toBe(8193);
    expect(metrics.turns).toBe(1);
    expect(metrics.durationMs).toBe(12);
  });

  it('prefers reported usage over estimates', () => {
    const attempt: Attempt = {
      output: 'anything',
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 4000,
        outputTokens: 50,
        peakContextTokens: 10_050,
        turns: 3,
      },
    };
    const metrics = computeMetrics(sample(), attempt, 100);
    expect(metrics.inputTokens).toBe(10_000);
    expect(metrics.cachedInputTokens).toBe(4000);
    expect(metrics.uncachedInputTokens).toBe(6000);
    expect(metrics.outputTokens).toBe(50);
    expect(metrics.peakContextTokens).toBe(10_050);
    expect(metrics.turns).toBe(3);
  });

  it('clamps cached tokens to not exceed input tokens', () => {
    const attempt: Attempt = {
      output: '',
      usage: { inputTokens: 100, cachedInputTokens: 500 },
    };
    const metrics = computeMetrics(sample(), attempt, 0);
    expect(metrics.cachedInputTokens).toBe(100);
    expect(metrics.uncachedInputTokens).toBe(0);
  });
});

describe('runInstrumented', () => {
  it('times the attempt with an injected clock', async () => {
    const times = [1000, 1075];
    const clock = (): number => times.shift() ?? 0;
    const { attempt, metrics } = await runInstrumented(
      sample(),
      () => Promise.resolve({ output: 'test' }),
      clock,
    );
    expect(attempt.output).toBe('test');
    expect(metrics.durationMs).toBe(75);
  });

  it('never reports a negative duration if the clock goes backwards', async () => {
    const times = [1000, 900];
    const clock = (): number => times.shift() ?? 0;
    const { metrics } = await runInstrumented(
      sample(),
      () => Promise.resolve({ output: '' }),
      clock,
    );
    expect(metrics.durationMs).toBe(0);
  });

  it('propagates a rejected attempt (no swallowing)', async () => {
    await expect(
      runInstrumented(sample(), () => Promise.reject(new Error('provider blew up'))),
    ).rejects.toThrow('provider blew up');
  });
});
