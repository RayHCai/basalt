import { initConfig, setSecret } from '@basalt/config';
import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext, CreateConfigSection } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultStorageReader } from '../storage.js';
import { runConfigCreate } from './config.js';

function makeContext(createConfigSection: CreateConfigSection): {
  ctx: CliContext;
  out: string[];
} {
  const out: string[] = [];
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
    createConfigSection,
    setSecret,
    evaluate,
    loadEvalRuns: loadAllRuns,
    loadEvalData: loadData,
    readSecretValue: () => Promise.resolve(''),
    storage: defaultStorageReader,
    palette: PLAIN,
    stdout: (text) => out.push(text),
    stderr: () => {},
    openPrompter: () => ({ question: () => Promise.resolve(null), close: () => {} }),
  };
  return { ctx, out };
}

describe('runConfigCreate', () => {
  it('delegates to createConfigSection with the kind + name and prints the path', async () => {
    const calls: [string, string][] = [];
    const fakeCreate = ((kind: string, name: string) => {
      calls.push([kind, name]);
      return Promise.resolve({
        kind,
        name,
        path: `/state/config/model-providers/${name}.json`,
      });
    }) as unknown as CreateConfigSection;
    const { ctx, out } = makeContext(fakeCreate);

    await runConfigCreate(ctx, 'model-provider', 'anthropic');

    expect(calls).toEqual([['model-provider', 'anthropic']]);
    const joined = out.join('\n');
    expect(joined).toContain('Created model-provider "anthropic"');
    expect(joined).toContain('/state/config/model-providers/anthropic.json');
    expect(joined).toContain('Edit the file above');
  });

  it('rejects an invalid name as a usage error before delegating', async () => {
    let called = false;
    const spy = (() => {
      called = true;
      return Promise.resolve({});
    }) as unknown as CreateConfigSection;
    const { ctx } = makeContext(spy);
    await expect(runConfigCreate(ctx, 'plugin', 'BadName')).rejects.toBeInstanceOf(UsageError);
    expect(called).toBe(false);
  });

  it('propagates a failure from createConfigSection to the caller', async () => {
    const failing = (() => Promise.reject(new Error('disk full'))) as CreateConfigSection;
    const { ctx } = makeContext(failing);
    await expect(runConfigCreate(ctx, 'plugin', 'valid-name')).rejects.toThrow('disk full');
  });
});
