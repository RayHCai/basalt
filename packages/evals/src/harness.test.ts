import { describe, expect, it, vi } from 'vitest';

import { createHarness, DEFAULT_MODEL, DEFAULT_PROVIDER } from './harness.js';
import type { StartTurn } from './harness.js';

describe('createHarness', () => {
  it('defaults to the dummy provider and model', () => {
    const harness = createHarness({
      configureConfig: () => Promise.resolve(),
      start: () => Promise.resolve('test'),
    });
    expect(harness.provider).toBe(DEFAULT_PROVIDER);
    expect(harness.model).toBe(DEFAULT_MODEL);
  });

  it('configures config exactly once when configure() is called', async () => {
    const configureConfig = vi.fn(() => Promise.resolve());
    const harness = createHarness({ configureConfig, start: () => Promise.resolve('test') });
    await harness.configure();
    expect(configureConfig).toHaveBeenCalledTimes(1);
  });

  it('drives the agent turn with the pinned provider/model session', async () => {
    const calls: { provider: string; model: string; message: string }[] = [];
    const start: StartTurn = (session, message) => {
      calls.push({ provider: session.provider, model: session.model, message });
      return Promise.resolve('test');
    };
    const harness = createHarness({
      provider: 'dummy',
      model: 'dummy-model',
      configureConfig: () => Promise.resolve(),
      start,
    });
    const attempt = await harness.attempt('what is the magic number?');
    expect(attempt.output).toBe('test');
    expect(attempt.usage).toBeUndefined();
    expect(calls).toEqual([
      { provider: 'dummy', model: 'dummy-model', message: 'what is the magic number?' },
    ]);
  });

  it('honors an explicit provider/model override', () => {
    const harness = createHarness({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      configureConfig: () => Promise.resolve(),
      start: () => Promise.resolve('x'),
    });
    expect(harness.provider).toBe('anthropic');
    expect(harness.model).toBe('claude-haiku-4-5');
  });

  it('propagates a turn error', async () => {
    const harness = createHarness({
      configureConfig: () => Promise.resolve(),
      start: () => Promise.reject(new Error('provider load failed')),
    });
    await expect(harness.attempt('hi')).rejects.toThrow('provider load failed');
  });
});
