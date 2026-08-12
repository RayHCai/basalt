import { describe, expect, it, vi } from 'vitest';

import { run } from './run.js';

describe('run', () => {
  it('configures config then runs a loop turn, returning the reply', async () => {
    const configureConfig = vi.fn().mockResolvedValue({});
    const start = vi.fn().mockResolvedValue('test');

    const result = await run({ kind: 'sendMessage', message: 'hi' }, { configureConfig, start });

    expect(result).toBe('test');
    expect(configureConfig).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    // Config must be configured BEFORE the loop runs (the loader needs it).
    expect(configureConfig.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('passes the session and message through to the loop', async () => {
    const session = { id: 's1', provider: 'dummy', model: 'm' };
    const start = vi.fn().mockResolvedValue('ok');

    await run(
      { kind: 'sendMessage', message: 'hello world' },
      { configureConfig: () => Promise.resolve(), start, session },
    );

    expect(start).toHaveBeenCalledWith(session, 'hello world');
  });

  it('propagates a loop failure', async () => {
    const start = vi.fn().mockRejectedValue(new Error('provider down'));
    await expect(
      run(
        { kind: 'sendMessage', message: 'hi' },
        { configureConfig: () => Promise.resolve(), start },
      ),
    ).rejects.toThrow('provider down');
  });
});
