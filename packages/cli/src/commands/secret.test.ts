import { initConfig } from '@basalt/config';
import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultStorageReader } from '../storage.js';
import { runSecretSet } from './secret.js';

/**
 * Build a context whose secret seams are scripted: `readSecretValue` returns
 * `value`, and `setSecret` records what it was asked to seal.
 */
function makeContext(
  value: string,
  overrides: Partial<CliContext> = {},
): { ctx: CliContext; out: string[]; sealed: [string, string][] } {
  const out: string[] = [];
  const sealed: [string, string][] = [];
  const ctx: CliContext = {
    run: runtimeRun,
    resolvePrimary: () =>
      Promise.resolve({ id: 'test', provider: 'anthropic', model: 'claude-haiku-4-5' }),
    startPrimary: () =>
      Promise.resolve({
        session: { id: 'test', provider: 'anthropic', model: 'claude-haiku-4-5' },
        release: () => {},
      }),
    initConfig,
    createConfigSection: (() => Promise.resolve({})) as never,
    setSecret: ((name: string, secretValue: string | { expose: () => string }) => {
      const raw = typeof secretValue === 'string' ? secretValue : secretValue.expose();
      sealed.push([name, raw]);
      return Promise.resolve();
    }) as unknown as CliContext['setSecret'],
    evaluate,
    loadEvalRuns: loadAllRuns,
    loadEvalData: loadData,
    readSecretValue: () => Promise.resolve(value),
    storage: defaultStorageReader,
    palette: PLAIN,
    stdout: (text) => out.push(text),
    stderr: () => {},
    openPrompter: () => ({ question: () => Promise.resolve(null), close: () => {} }),
    ...overrides,
  };
  return { ctx, out, sealed };
}

describe('runSecretSet', () => {
  it('reads the value from the safe reader and seals it under the given name', async () => {
    const { ctx, out, sealed } = makeContext('sk-ant-123');

    await runSecretSet(ctx, 'anthropic-api-key');

    expect(sealed).toEqual([['anthropic-api-key', 'sk-ant-123']]);
    expect(out.join('\n')).toContain('Set secret "anthropic-api-key"');
  });

  it('never reveals the value in output (only a redacted confirmation)', async () => {
    const { ctx, out } = makeContext('super-secret-value');

    await runSecretSet(ctx, 'token');

    const joined = out.join('\n');
    expect(joined).not.toContain('super-secret-value');
    expect(joined).toContain('[redacted]');
  });

  it('rejects an invalid name as a usage error before reading or sealing', async () => {
    let read = false;
    const { ctx, sealed } = makeContext('x', {
      readSecretValue: () => {
        read = true;
        return Promise.resolve('x');
      },
    });

    await expect(runSecretSet(ctx, 'Bad Name')).rejects.toBeInstanceOf(UsageError);
    expect(read).toBe(false);
    expect(sealed).toEqual([]);
  });

  it('rejects an empty value (nothing piped / entered) without sealing', async () => {
    const { ctx, sealed } = makeContext('');

    await expect(runSecretSet(ctx, 'token')).rejects.toBeInstanceOf(UsageError);
    expect(sealed).toEqual([]);
  });

  it('propagates a failure from the sealing layer', async () => {
    const { ctx } = makeContext('value', {
      setSecret: (() => Promise.reject(new Error('store write failed'))) as never,
    });

    await expect(runSecretSet(ctx, 'token')).rejects.toThrow('store write failed');
  });
});
