import { isSecret, Secret } from '@basalt/secrets';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isValidName } from './names.js';
import {
  collectStoreNames,
  extractSecrets,
  fieldRef,
  redactSecrets,
  resolveSecrets,
  scopeRef,
  secretStoreName,
} from './secrets-bridge.js';
import { REDACTED, secret } from './secret-field.js';

const schema = z.object({
  enabled: z.boolean(),
  apiKey: secret(),
  optionalKey: secret().optional(),
  auth: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('harness'), env: z.record(z.string(), secret()) }),
  ]),
  headers: z.record(z.string(), z.string()),
});

describe('ref + store-name derivation', () => {
  it('builds a readable scope ref per kind', () => {
    expect(scopeRef('main')).toBe('main');
    expect(scopeRef('modelProvider', 'anthropic')).toBe('model-provider.anthropic');
    expect(scopeRef('plugin', 'github')).toBe('plugin.github');
  });

  it('joins a field path onto the scope with a stable delimiter', () => {
    expect(fieldRef('main', ['gateway', 'accessToken'])).toBe('main#gateway.accessToken');
    expect(fieldRef('model-provider.anthropic', ['auth', 'env', 'KEY'])).toBe(
      'model-provider.anthropic#auth.env.KEY',
    );
  });

  it('derives a deterministic, valid secret-store name from a ref', () => {
    const a = secretStoreName('main#gateway.accessToken');
    const b = secretStoreName('main#gateway.accessToken');
    expect(a).toBe(b);
    expect(isValidName(a)).toBe(true);
    expect(a).not.toBe(secretStoreName('main#other'));
  });
});

describe('extractSecrets', () => {
  const scope = scopeRef('modelProvider', 'anthropic');

  it('replaces plaintext leaves with markers and yields pending writes to seal', () => {
    const { value, writes } = extractSecrets(schema, scope, {
      enabled: true,
      apiKey: 'sk-live-123',
      auth: { kind: 'none' },
      headers: { 'x-h': 'plain' },
    });
    // On-disk value carries a marker, never the plaintext.
    const marker = (value as { apiKey: { $secret: string } }).apiKey;
    expect(marker.$secret).toBe(`${scope}#apiKey`);
    expect(JSON.stringify(value)).not.toContain('sk-live-123');
    // The plaintext is queued for sealing under the derived store name.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.storeName).toBe(secretStoreName(`${scope}#apiKey`));
    expect(writes[0]?.input).toBe('sk-live-123');
    // Non-secret data is untouched.
    expect((value as { headers: unknown }).headers).toEqual({ 'x-h': 'plain' });
  });

  it('accepts a Secret box as input and queues it directly (never exposed here)', () => {
    const { writes } = extractSecrets(schema, scope, {
      enabled: true,
      apiKey: new Secret('boxed'),
      auth: { kind: 'none' },
      headers: {},
    });
    expect(writes).toHaveLength(1);
    expect(isSecret(writes[0]?.input)).toBe(true);
  });

  it('walks secrets inside the selected union branch and records', () => {
    const { value, writes } = extractSecrets(schema, scope, {
      enabled: true,
      apiKey: 'k',
      auth: { kind: 'harness', env: { A: 'sec-a', B: 'sec-b' } },
      headers: {},
    });
    const refs = writes.map((w) => w.ref).toSorted();
    expect(refs).toEqual([`${scope}#apiKey`, `${scope}#auth.env.A`, `${scope}#auth.env.B`]);
    const { auth } = value as { auth: { env: Record<string, { $secret: string }> } };
    expect(auth.env['A']?.$secret).toBe(`${scope}#auth.env.A`);
  });

  it('keeps an already-present marker without re-sealing it', () => {
    const existingRef = `${scope}#apiKey`;
    const { value, writes } = extractSecrets(schema, scope, {
      enabled: true,
      apiKey: { $secret: existingRef },
      auth: { kind: 'none' },
      headers: {},
    });
    expect((value as { apiKey: { $secret: string } }).apiKey.$secret).toBe(existingRef);
    // No plaintext supplied → nothing new to seal.
    expect(writes).toHaveLength(0);
  });

  it('omits an optional secret that is absent', () => {
    const { writes } = extractSecrets(schema, scope, {
      enabled: true,
      apiKey: 'k',
      auth: { kind: 'none' },
      headers: {},
    });
    expect(writes.map((w) => w.ref)).toEqual([`${scope}#apiKey`]);
  });
});

describe('resolveSecrets', () => {
  it('turns markers into Secret boxes via the lookup, leaving other fields intact', () => {
    const scope = scopeRef('modelProvider', 'anthropic');
    const stored = {
      enabled: true,
      apiKey: { $secret: `${scope}#apiKey` },
      auth: { kind: 'harness', env: { A: { $secret: `${scope}#auth.env.A` } } },
      headers: { 'x-h': 'plain' },
    };
    const table: Record<string, Secret> = {
      [secretStoreName(`${scope}#apiKey`)]: new Secret('resolved-key'),
      [secretStoreName(`${scope}#auth.env.A`)]: new Secret('resolved-a'),
    };
    const resolved = resolveSecrets(schema, stored, (name) => table[name]) as {
      apiKey: Secret;
      auth: { env: { A: Secret } };
      headers: Record<string, string>;
      enabled: boolean;
    };
    expect(isSecret(resolved.apiKey)).toBe(true);
    expect(resolved.apiKey.expose()).toBe('resolved-key');
    expect(resolved.auth.env.A.expose()).toBe('resolved-a');
    expect(resolved.headers).toEqual({ 'x-h': 'plain' });
    expect(resolved.enabled).toBe(true);
  });

  it('yields undefined for a marker with no backing secret (dangling ref)', () => {
    const scope = scopeRef('main');
    const stored = {
      enabled: true,
      apiKey: { $secret: `${scope}#apiKey` },
      auth: { kind: 'none' },
      headers: {},
    };
    // An empty lookup table: every ref misses, so a dangling marker resolves to
    // undefined rather than throwing.
    const empty = new Map<string, Secret>();
    const resolved = resolveSecrets(schema, stored, (name) => empty.get(name)) as {
      apiKey: Secret | undefined;
    };
    expect(resolved.apiKey).toBeUndefined();
  });
});

describe('redactSecrets', () => {
  it('replaces every secret marker with the placeholder and never leaks a ref', () => {
    const scope = scopeRef('modelProvider', 'anthropic');
    const stored = {
      enabled: true,
      apiKey: { $secret: `${scope}#apiKey` },
      auth: { kind: 'harness', env: { A: { $secret: `${scope}#auth.env.A` } } },
      headers: { 'x-h': 'plain' },
    };
    const redacted = redactSecrets(schema, stored);
    expect(redacted).toEqual({
      enabled: true,
      apiKey: REDACTED,
      auth: { kind: 'harness', env: { A: REDACTED } },
      headers: { 'x-h': 'plain' },
    });
    expect(JSON.stringify(redacted)).not.toContain('$secret');
  });
});

describe('collectStoreNames', () => {
  it('enumerates the store name behind every marker present in a value', () => {
    const scope = scopeRef('modelProvider', 'anthropic');
    const stored = {
      enabled: true,
      apiKey: { $secret: `${scope}#apiKey` },
      auth: { kind: 'harness', env: { A: { $secret: `${scope}#auth.env.A` } } },
      headers: {},
    };
    const names = collectStoreNames(schema, stored);
    expect(names).toEqual(
      new Set([secretStoreName(`${scope}#apiKey`), secretStoreName(`${scope}#auth.env.A`)]),
    );
  });

  it('enumerates the single store name when only one secret marker is present', () => {
    expect(
      collectStoreNames(schema, {
        enabled: true,
        apiKey: { $secret: 'x' },
        auth: { kind: 'none' },
        headers: {},
      }),
    ).toEqual(new Set([secretStoreName('x')]));
  });
});
