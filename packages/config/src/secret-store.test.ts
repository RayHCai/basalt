import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSecretStore, resetSecretStores } from './secret-store.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-config-secret-store-'));
});

afterEach(async () => {
  resetSecretStores();
  await rm(dir, { recursive: true, force: true });
});

describe('openSecretStore', () => {
  it('memoizes a single store per STATE_DIR', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const first = await openSecretStore(env);
    const second = await openSecretStore(env);
    // Same STATE_DIR → the exact same instance (one master-key resolution).
    expect(second).toBe(first);
  });

  it('dedupes concurrent opens onto one instance', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const [a, b] = await Promise.all([openSecretStore(env), openSecretStore(env)]);
    expect(a).toBe(b);
  });

  it('opens the store under <STATE_DIR>/secrets and round-trips a value', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const store = await openSecretStore(env);
    await store.set('gateway-token', 'hunter2');
    // A fresh reset + reopen reads the same on-disk store back.
    resetSecretStores();
    const reopened = await openSecretStore(env);
    expect(reopened).not.toBe(store);
    expect(reopened.get('gateway-token')?.expose()).toBe('hunter2');
  });

  it('does not cache a failed open (untrusted context), so a later trusted open works', async () => {
    await expect(
      openSecretStore({ BASALT_STATE_DIR: dir, BASALT_UNTRUSTED: '1' }),
    ).rejects.toThrow();
    // The rejected open was evicted; a trusted call for the same dir succeeds.
    const store = await openSecretStore({ BASALT_STATE_DIR: dir });
    expect(store.list()).toEqual([]);
  });

  it('resetSecretStores drops the memoized instances', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const first = await openSecretStore(env);
    resetSecretStores();
    const afterReset = await openSecretStore(env);
    expect(afterReset).not.toBe(first);
  });
});
