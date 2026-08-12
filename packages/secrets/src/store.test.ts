import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Secret } from './secret.js';
import { createSecretStore } from './store.js';
import type { SecretStore } from './store.js';
import { UNTRUSTED_ENV_VAR } from './trust.js';

// oxlint-disable-next-line init-declarations
let dir: string;
// oxlint-disable-next-line init-declarations
let store: SecretStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-secrets-store-'));
  store = await createSecretStore({ dir, env: {} });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SecretStore', () => {
  it('sets and gets a secret round-trip', async () => {
    await store.set('gateway-token', 'hunter2');
    expect(store.get('gateway-token')?.expose()).toBe('hunter2');
  });

  it('accepts a Secret instance on set', async () => {
    await store.set('token', new Secret('s3cr3t'));
    expect(store.get('token')?.expose()).toBe('s3cr3t');
  });

  it('returns undefined for a missing secret', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('require throws for a missing secret', () => {
    expect(() => store.require('nope')).toThrow();
  });

  it('lists secret names without exposing values', async () => {
    await store.set('a', 'x');
    await store.set('b', 'y');
    const names = store.list();
    expect(names.toSorted()).toEqual(['a', 'b']);
    expect(JSON.stringify(names)).not.toContain('x');
  });

  it('reports existence with has()', async () => {
    await store.set('a', 'x');
    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
  });

  it('overwrites an existing secret', async () => {
    await store.set('a', 'first');
    await store.set('a', 'second');
    expect(store.get('a')?.expose()).toBe('second');
  });

  it('deletes a secret', async () => {
    await store.set('a', 'x');
    expect(await store.delete('a')).toBe(true);
    expect(store.has('a')).toBe(false);
    expect(await store.delete('a')).toBe(false);
  });

  it('persists across store instances (encrypted at rest)', async () => {
    await store.set('a', 'persisted');
    const reopened = await createSecretStore({ dir, env: {} });
    expect(reopened.get('a')?.expose()).toBe('persisted');
  });

  it('never writes plaintext to disk', async () => {
    await store.set('gateway-token', 'super-secret-value');
    const raw = await readFile(join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('super-secret-value');
    // Name (a non-secret label) may appear; the value must not.
    expect(raw).toContain('gateway-token');
  });

  it('writes the store file with 0600 permissions', async () => {
    await store.set('a', 'x');
    const info = await stat(join(dir, 'secrets.json'));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('validates secret names (rejects path traversal / bad chars)', async () => {
    await expect(store.set('../escape', 'x')).rejects.toThrow();
    await expect(store.set('a/b', 'x')).rejects.toThrow();
    await expect(store.set('', 'x')).rejects.toThrow();
    await expect(store.set('UPPER', 'x')).rejects.toThrow();
  });

  it('rejects an empty secret value', async () => {
    await expect(store.set('a', '')).rejects.toThrow();
  });

  describe('untrusted context (agent harness)', () => {
    it('refuses to construct a store', async () => {
      await expect(createSecretStore({ dir, env: { [UNTRUSTED_ENV_VAR]: '1' } })).rejects.toThrow();
    });

    it('refuses get/set even if a handle leaks in', async () => {
      // Build trusted, then simulate the same handle being used from untrusted
      // code by flipping the store's env view.
      await store.set('a', 'x');
      const untrusted = await createSecretStore({ dir, env: {} });
      untrusted.withEnv({ [UNTRUSTED_ENV_VAR]: '1' });
      expect(() => untrusted.get('a')).toThrow();
      await expect(untrusted.set('b', 'y')).rejects.toThrow();
    });
  });

  describe('redaction view', () => {
    it('produces a name→[redacted] map safe to log', async () => {
      await store.set('a', 'x');
      await store.set('b', 'y');
      const view = store.redacted();
      expect(view).toEqual({ a: '[redacted]', b: '[redacted]' });
      expect(JSON.stringify(view)).not.toContain('"x"');
    });
  });
});
