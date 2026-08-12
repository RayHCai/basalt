import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretStore, Secret } from '@basalt/secrets';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetSecretStores } from './secret-store.js';
import { secretStoreName } from './secrets-bridge.js';
import { setSecret } from './set-secret.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-config-set-secret-'));
});

afterEach(async () => {
  resetSecretStores();
  await rm(dir, { recursive: true, force: true });
});

describe('setSecret', () => {
  it('seals the value under the DERIVED store name a config marker resolves to', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });

    await setSecret('anthropic-api-key', 'sk-ant-123', { env, secrets });

    // The value is NOT stored under the literal name — it is stored under the
    // hashed name config's resolver looks a `{ "$secret": "anthropic-api-key" }`
    // marker up by. This is the whole point of routing through config.
    expect(secrets.get('anthropic-api-key')).toBeUndefined();
    expect(secrets.get(secretStoreName('anthropic-api-key'))?.expose()).toBe('sk-ant-123');
  });

  it('accepts a Secret box as well as a raw string', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });

    await setSecret('token', new Secret('boxed-value'), { env, secrets });

    expect(secrets.get(secretStoreName('token'))?.expose()).toBe('boxed-value');
  });

  it('overwrites an existing value for the same name', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });

    await setSecret('token', 'first', { env, secrets });
    await setSecret('token', 'second', { env, secrets });

    expect(secrets.get(secretStoreName('token'))?.expose()).toBe('second');
  });

  it('persists across a fresh store open (encrypted at rest under <STATE_DIR>/secrets)', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await setSecret('gateway-token', 'hunter2', { env });

    // Reopen the store from disk — the sealed value round-trips.
    resetSecretStores();
    const reopened = await createSecretStore({ dir: join(dir, 'secrets'), env });
    expect(reopened.get(secretStoreName('gateway-token'))?.expose()).toBe('hunter2');
  });

  it('rejects an invalid secret name before touching the store', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await expect(setSecret('Bad Name', 'x', { env })).rejects.toThrow();
  });

  it('rejects an empty value (the store refuses a zero-length secret)', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await expect(setSecret('token', '', { env })).rejects.toThrow();
  });

  it('opens a store at <STATE_DIR>/secrets when none is injected', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await setSecret('auto-opened', 'value', { env });

    const store = await createSecretStore({ dir: join(dir, 'secrets'), env });
    expect(store.get(secretStoreName('auto-opened'))?.expose()).toBe('value');
  });
});
