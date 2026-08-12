import { run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { createContext } from './context.js';
import { defaultStorageReader } from './storage.js';

describe('createContext', () => {
  it('defaults to the real runtime run', () => {
    // Wired to the real runtime by default; behavior (a loop turn against disk)
    // is the runtime's concern and is exercised in its own package.
    expect(createContext().run).toBe(runtimeRun);
  });

  it('uses a supplied run function', () => {
    expect(createContext({ run: runtimeRun }).run).toBe(runtimeRun);
  });

  it('defaults storage to a real storage reader (backed by @basalt/storage)', () => {
    const ctx = createContext();
    expect(ctx.storage).toBeDefined();
    expect(typeof ctx.storage.listSessions).toBe('function');
    expect(typeof ctx.storage.listCronJobs).toBe('function');
  });

  it('uses a supplied storage reader', () => {
    const ctx = createContext({ storage: defaultStorageReader });
    expect(ctx.storage).toBe(defaultStorageReader);
  });

  it('exposes a config init seam and lets it be injected', () => {
    const fakeInit = (() => Promise.resolve({})) as never;
    expect(createContext({ initConfig: fakeInit }).initConfig).toBe(fakeInit);
  });

  it('exposes a config section-create seam and lets it be injected', () => {
    const fakeCreate = (() => Promise.resolve({})) as never;
    expect(createContext({ createConfigSection: fakeCreate }).createConfigSection).toBe(fakeCreate);
  });

  it('resolves a plain palette when color is forced off', () => {
    const ctx = createContext({ color: false, env: {} });
    expect(ctx.palette.red('x')).toBe('x');
  });

  it('resolves a coloring palette when color is forced on', () => {
    const ctx = createContext({ color: true, env: {} });
    expect(ctx.palette.red('x')).not.toBe('x');
  });

  it('exposes writers wired to the process streams', () => {
    const ctx = createContext();
    expect(typeof ctx.stdout).toBe('function');
    expect(typeof ctx.stderr).toBe('function');
  });
});
