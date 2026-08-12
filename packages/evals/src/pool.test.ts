import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { runPool } from './pool.js';

describe('runPool', () => {
  it('preserves input order regardless of completion order', async () => {
    const tasks = [30, 10, 20, 5].map((ms, i) => async () => {
      await delay(ms);
      return i;
    });
    const results = await runPool(tasks, 2);
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight -= 1;
      return null;
    });
    await runPool(tasks, 4);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('resolves an empty task list to an empty array', async () => {
    expect(await runPool([], 4)).toEqual([]);
  });

  it('clamps concurrency to at least 1', async () => {
    const results = await runPool([() => Promise.resolve('a'), () => Promise.resolve('b')], 0);
    expect(results).toEqual(['a', 'b']);
  });

  it('runs every task exactly once', async () => {
    const counts = new Map<number, number>();
    const tasks = Array.from({ length: 50 }, (_, i) => () => {
      counts.set(i, (counts.get(i) ?? 0) + 1);
      return Promise.resolve(i);
    });
    await runPool(tasks, 8);
    expect(counts.size).toBe(50);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
  });

  it('rejects if a task rejects', async () => {
    await expect(
      runPool([() => Promise.resolve(1), () => Promise.reject(new Error('boom'))], 2),
    ).rejects.toThrow('boom');
  });
});
