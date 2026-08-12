import { describe, expect, it, vi } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext } from '../context.js';
import { defaultStorageReader } from '../storage.js';
import { runStart } from './start.js';

const TEST_SESSION = {
  id: 'primary-abc',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
} as const;

/** Milliseconds to wait before the simulated Ctrl-C that ends the tail. */
const SIGINT_DELAY_MS = 50;

function createTestContext(overrides: Partial<CliContext> = {}): CliContext {
  const lines: string[] = [];
  return {
    run: vi.fn().mockResolvedValue('reply'),
    resolvePrimary: vi.fn().mockResolvedValue(TEST_SESSION),
    startPrimary: vi.fn().mockResolvedValue({ session: TEST_SESSION, release: vi.fn() }),
    initConfig: vi.fn().mockResolvedValue({ file: '/tmp/test', created: true }),
    createConfigSection: vi.fn().mockResolvedValue({ file: '/tmp/test', created: true }),
    setSecret: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue({}),
    loadEvalRuns: vi.fn().mockResolvedValue([]),
    loadEvalData: vi.fn().mockResolvedValue({}),
    readSecretValue: vi.fn().mockResolvedValue('secret-value'),
    storage: defaultStorageReader,
    palette: PLAIN,
    stdout: (text: string) => {
      lines.push(text);
    },
    stderr: (text: string) => {
      lines.push(text);
    },
    openPrompter: vi.fn(),
    ...overrides,
  };
}

/**
 * A `startPrimary` double that schedules a SIGINT right after claiming, so
 * `runStart`'s log tail aborts and the call returns instead of blocking.
 */
function startPrimaryThenSigint(release: () => void): CliContext['startPrimary'] {
  return vi.fn().mockImplementation(() => {
    setTimeout(() => process.emit('SIGINT', 'SIGINT'), SIGINT_DELAY_MS);
    return Promise.resolve({ session: TEST_SESSION, release });
  });
}

describe('runStart', () => {
  it('calls startPrimary with the current process pid', async () => {
    const startPrimary = startPrimaryThenSigint(vi.fn());

    const ctx = createTestContext({ startPrimary });
    await runStart(ctx);

    expect(startPrimary).toHaveBeenCalledWith({ pid: process.pid });
  });

  it('calls release on SIGINT', async () => {
    const release = vi.fn();
    const ctx = createTestContext({ startPrimary: startPrimaryThenSigint(release) });

    await runStart(ctx);

    expect(release).toHaveBeenCalled();
  });

  it('propagates PrimaryAlreadyClaimedError from startPrimary', async () => {
    const error = new Error('A live primary session already exists');
    error.name = 'PrimaryAlreadyClaimedError';
    const startPrimary = vi.fn().mockRejectedValue(error);

    const ctx = createTestContext({ startPrimary });
    await expect(runStart(ctx)).rejects.toThrow('A live primary session already exists');
  });
});
