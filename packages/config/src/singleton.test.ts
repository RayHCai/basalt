import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretStore } from '@basalt/secrets';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureConfig, getConfig, resetConfig } from './singleton.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-config-singleton-'));
});

afterEach(async () => {
  resetConfig();
  await rm(dir, { recursive: true, force: true });
});

describe('config singleton', () => {
  it('throws from getConfig before configureConfig has run', () => {
    expect(() => getConfig()).toThrow(/not configured/u);
  });

  it('returns a loaded, synchronously-readable store after configureConfig', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });

    const returned = await configureConfig({ env, secrets });
    // getConfig hands back the same memoized instance, ready to read.
    expect(getConfig()).toBe(returned);
    expect(getConfig().main().telemetry).toBe(false);
  });

  it('opens its own secret store when none is injected', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await configureConfig({ env });
    expect(getConfig().main().telemetry).toBe(false);
  });

  it('resetConfig clears the shared store', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await configureConfig({ env });
    resetConfig();
    expect(() => getConfig()).toThrow(/not configured/u);
  });
});
