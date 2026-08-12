import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decrypt, encrypt, KEY_BYTES } from './crypto.js';
import type { SealedBox } from './crypto.js';
import { Secret } from './secret.js';

const key = randomBytes(KEY_BYTES);

describe('crypto', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const box = encrypt(key, 'token', new Secret('hunter2'));
    const out = decrypt(key, 'token', box);
    expect(out.expose()).toBe('hunter2');
  });

  it('round-trips unicode and long values', () => {
    const value = `🔑 café ${'x'.repeat(10_000)}`;
    const box = encrypt(key, 'name', new Secret(value));
    expect(decrypt(key, 'name', box).expose()).toBe(value);
  });

  it('produces a fresh IV each call (no ciphertext reuse)', () => {
    const a = encrypt(key, 'token', new Secret('same'));
    const b = encrypt(key, 'token', new Secret('same'));
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('never places plaintext in the sealed box', () => {
    const box = encrypt(key, 'token', new Secret('hunter2'));
    expect(JSON.stringify(box)).not.toContain('hunter2');
  });

  it('fails to decrypt with the wrong key', () => {
    const box = encrypt(key, 'token', new Secret('hunter2'));
    expect(() => decrypt(randomBytes(KEY_BYTES), 'token', box)).toThrow();
  });

  it('fails to decrypt when the name (AAD) does not match — no relabeling', () => {
    const box = encrypt(key, 'gateway-token', new Secret('hunter2'));
    expect(() => decrypt(key, 'other-token', box)).toThrow();
  });

  it('fails to decrypt tampered ciphertext (GCM auth)', () => {
    const box = encrypt(key, 'token', new Secret('hunter2'));
    const bytes = Buffer.from(box.ct, 'base64');
    bytes[0] = ((bytes[0] ?? 0) + 1) % 256;
    const tampered: SealedBox = { ...box, ct: bytes.toString('base64') };
    expect(() => decrypt(key, 'token', tampered)).toThrow();
  });

  it('rejects a key of the wrong size', () => {
    expect(() => encrypt(randomBytes(16), 'token', new Secret('x'))).toThrow(RangeError);
  });
});
