import { createConfigSection, setSecret } from '@basalt/config';
import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext, InitConfig } from '../context.js';
import { defaultStorageReader } from '../storage.js';
import { runInit } from './init.js';

/**
 * A fake initConfig result shaped like `@basalt/config`'s InitConfigResult. Cast
 * through `unknown` so this stays valid as config adds section kinds (tools,
 * mcpServers, …) — the CLI's init handler only reads a stable subset.
 */
function fakeResult(overrides: Record<string, unknown> = {}): ReturnType<InitConfig> {
  return Promise.resolve({
    store: {},
    seeded: true,
    stateDir: '/state',
    configDir: '/state/config',
    secretsDir: '/state/secrets',
    agentDir: '/state/agent',
    agentToolsDir: '/state/agent/tools',
    agentMcpsDir: '/state/agent/mcps',
    agentModelProvidersDir: '/state/agent/model-providers',
    mainConfigPath: '/state/config/main.json',
    modelProviders: [],
    plugins: [],
    tools: [],
    mcpServers: [],
    ...overrides,
  }) as unknown as ReturnType<InitConfig>;
}

function makeContext(initConfig: InitConfig): { ctx: CliContext; out: string[] } {
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

describe('runInit', () => {
  it('calls @basalt/config initConfig directly and reports the state dir layout', async () => {
    let called = false;
    const fakeInit = (() => {
      called = true;
      return fakeResult({ seeded: true, stateDir: '/state', configDir: '/state/config' });
    }) as InitConfig;
    const { ctx, out } = makeContext(fakeInit);

    await runInit(ctx);

    const joined = out.join('\n');
    expect(called).toBe(true);
    expect(out[0]).toContain('Initializing Basalt');
    expect(joined).toContain('State directory: /state');
    expect(joined).toContain('Created config');
    expect(joined).toContain('/state/config');
    expect(joined).toContain('/state/secrets');
    expect(joined).toContain('Agent code');
    expect(joined).toContain('/state/agent');
    expect(out.at(-1)).toContain('Basalt is ready.');
  });

  it('reports an existing config (not seeded) and section counts', async () => {
    const fakeInit = (() =>
      fakeResult({
        seeded: false,
        modelProviders: ['anthropic', 'openai'],
        plugins: ['github'],
      })) as InitConfig;
    const { ctx, out } = makeContext(fakeInit);

    await runInit(ctx);

    const joined = out.join('\n');
    expect(joined).toContain('Using config');
    expect(joined).toContain('2 model provider(s), 1 plugin(s)');
  });

  it('propagates a failure from initConfig to the caller', async () => {
    const failing = (() => Promise.reject(new Error('config init failed'))) as InitConfig;
    const { ctx } = makeContext(failing);
    await expect(runInit(ctx)).rejects.toThrow('config init failed');
  });
});
