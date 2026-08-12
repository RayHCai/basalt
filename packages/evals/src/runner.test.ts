import { describe, expect, it } from 'vitest';

import type { Attempt } from './instrument.js';
import { buildWorkItems, runSamples } from './runner.js';
import type { Sample } from './task.js';

function sample(id: string, inputTokens = 8192): Sample {
  // The id is arbitrary for the runner (it just echoes it as sampleId); the
  // `task` must be a REAL RULER task so the scorer's metric lookup resolves.
  const [, length, index] = id.split('/');
  return {
    id,
    task: 'niah_single_1',
    nominalLength: Number(length ?? 8192) as Sample['nominalLength'],
    index: Number(index ?? 0),
    input: `find the number 123456. ${'x'.repeat(inputTokens * 4)}`,
    answers: ['123456'],
    answerPrefix: '',
    inputTokens,
  };
}

/** A fixed clock so durations are deterministic. */
const fixedClock = (): number => 0;

/** A correct-answer attempt (passes the scorer). Hoisted: captures nothing. */
const answerAttempt = (): Promise<Attempt> => Promise.resolve({ output: 'the number is 123456' });

/** The dummy constant attempt (always fails the scorer). Hoisted: captures nothing. */
const dummyAttempt = (): Promise<Attempt> => Promise.resolve({ output: 'test' });

/** A correct-answer attempt that reports 5 turns (for the turn-cap test). */
const fiveTurnAttempt = (): Promise<Attempt> =>
  Promise.resolve({ output: 'the number is 123456', usage: { turns: 5 } });

/** An attempt that always rejects (for the failed-duration test). */
const failingAttempt = (): Promise<Attempt> => Promise.reject(new Error('slow failure'));

describe('buildWorkItems', () => {
  it('produces sample × rep items in grid order', () => {
    const items = buildWorkItems([sample('a/8192/0'), sample('b/8192/0')], 2);
    expect(items.map((i) => `${i.sample.id}#${i.rep.toString()}`)).toEqual([
      'a/8192/0#0',
      'a/8192/0#1',
      'b/8192/0#0',
      'b/8192/0#1',
    ]);
  });
});

describe('runSamples', () => {
  it('grades a correct attempt as passed', async () => {
    const results = await runSamples([sample('niah_single/8192/0')], answerAttempt, {
      clock: fixedClock,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.score).toBe(1);
  });

  it('grades the dummy constant as failed (never passes a real score)', async () => {
    const results = await runSamples([sample('niah_single/8192/0')], dummyAttempt, {
      clock: fixedClock,
    });
    expect(results[0]?.passed).toBe(false);
  });

  it('produces one result per (sample, rep) in grid order', async () => {
    const results = await runSamples([sample('a/8192/0'), sample('b/8192/0')], dummyAttempt, {
      reps: 3,
      clock: fixedClock,
    });
    expect(results).toHaveLength(6);
    expect(results.map((r) => `${r.sampleId}#${r.rep.toString()}`)).toEqual([
      'a/8192/0#0',
      'a/8192/0#1',
      'a/8192/0#2',
      'b/8192/0#0',
      'b/8192/0#1',
      'b/8192/0#2',
    ]);
  });

  it('records a provider error as a failed result without aborting the run', async () => {
    let call = 0;
    const attempt = (): Promise<Attempt> => {
      call += 1;
      if (call === 1) {
        return Promise.reject(new Error('provider exploded'));
      }
      return Promise.resolve({ output: 'test' });
    };
    // concurrency 1 so the first work item is the one that throws.
    const results = await runSamples([sample('a/8192/0'), sample('b/8192/0')], attempt, {
      concurrency: 1,
      clock: fixedClock,
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.error).toBe('provider exploded');
    expect(results[0]?.passed).toBe(false);
    expect(results[1]?.error).toBeUndefined();
  });

  it('records the elapsed duration of a failed attempt (not zero)', async () => {
    // A provider that runs for a while before throwing must have its burned time
    // recorded, so a run that errors is not reported as instantaneous.
    const times = [1000, 1250];
    const slowFailingClock = (): number => times.shift() ?? 1250;
    const results = await runSamples([sample('a/8192/0')], failingAttempt, {
      clock: slowFailingClock,
    });
    expect(results[0]?.error).toBe('slow failure');
    expect(results[0]?.metrics.durationMs).toBe(250);
  });

  it('short-circuits an over-cap input without calling the provider', async () => {
    let called = false;
    const attempt = (): Promise<Attempt> => {
      called = true;
      return Promise.resolve({ output: 'test' });
    };
    const results = await runSamples([sample('a/8192/0', 8192)], attempt, {
      maxInputTokens: 4096,
      clock: fixedClock,
    });
    expect(called).toBe(false);
    expect(results[0]?.error).toContain('exceeds cap');
    expect(results[0]?.passed).toBe(false);
  });

  it('marks an over-turn attempt as failed', async () => {
    const results = await runSamples([sample('a/8192/0')], fiveTurnAttempt, {
      maxTurns: 2,
      clock: fixedClock,
    });
    expect(results[0]?.error).toContain('exceeds cap');
    expect(results[0]?.passed).toBe(false);
    // The output is preserved even though the attempt failed the cap.
    expect(results[0]?.output).toContain('123456');
  });

  it('respects an input within the cap', async () => {
    const results = await runSamples([sample('a/8192/0', 4000)], answerAttempt, {
      maxInputTokens: 8192,
      clock: fixedClock,
    });
    expect(results[0]?.error).toBeUndefined();
    expect(results[0]?.passed).toBe(true);
  });
});
