import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KEY_BYTES } from './crypto.js';
import { KEY_ENV_VAR, resolveMasterKey } from './key.js';
import { UNTRUSTED_ENV_VAR } from './trust.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-secrets-key-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('resolveMasterKey', () => {
  it('reads a base64 key from the environment', async () => {
    const raw = Buffer.alloc(KEY_BYTES, 7);
    const key = await resolveMasterKey(dir, { [KEY_ENV_VAR]: raw.toString('base64') });
    expect(key.equals(raw)).toBe(true);
  });

  it('reads a hex key from the environment', async () => {
    const raw = Buffer.alloc(KEY_BYTES, 9);
    const key = await resolveMasterKey(dir, { [KEY_ENV_VAR]: raw.toString('hex') });
    expect(key.equals(raw)).toBe(true);
  });

  it('rejects an env key of the wrong size', async () => {
    await expect(
      resolveMasterKey(dir, { [KEY_ENV_VAR]: Buffer.alloc(16).toString('base64') }),
    ).rejects.toThrow();
  });

  it('generates a keyfile on first use and reuses it after', async () => {
    const first = await resolveMasterKey(dir, {});
    const second = await resolveMasterKey(dir, {});
    expect(first.length).toBe(KEY_BYTES);
    expect(first.equals(second)).toBe(true);
  });

  it('writes the generated keyfile with 0600 permissions', async () => {
    await resolveMasterKey(dir, {});
    const info = await stat(join(dir, 'key'));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('prefers the env key over an existing keyfile', async () => {
    const fileKey = await resolveMasterKey(dir, {});
    const envRaw = Buffer.alloc(KEY_BYTES, 3);
    const key = await resolveMasterKey(dir, { [KEY_ENV_VAR]: envRaw.toString('base64') });
    expect(key.equals(envRaw)).toBe(true);
    expect(key.equals(fileKey)).toBe(false);
  });

  it('reads a raw 32-byte keyfile', async () => {
    const raw = Buffer.alloc(KEY_BYTES, 5);
    await writeFile(join(dir, 'key'), raw, { mode: 0o600 });
    const key = await resolveMasterKey(dir, {});
    expect(key.equals(raw)).toBe(true);
  });

  it('refuses to resolve a key in an untrusted context', async () => {
    await expect(resolveMasterKey(dir, { [UNTRUSTED_ENV_VAR]: '1' })).rejects.toThrow();
  });

  it('does not create a keyfile when denied by the trust gate', async () => {
    await expect(resolveMasterKey(dir, { [UNTRUSTED_ENV_VAR]: '1' })).rejects.toThrow();
    await expect(readFile(join(dir, 'key'))).rejects.toThrow();
  });
});
