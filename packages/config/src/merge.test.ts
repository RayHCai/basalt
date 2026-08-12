import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { schemaAwareMerge } from './merge.js';
import { secret } from './secret-field.js';

describe('schemaAwareMerge', () => {
  const schema = z.object({
    logLevel: z.string(),
    telemetry: z.boolean(),
    gateway: z.object({
      baseUrl: z.string().optional(),
      timeoutMs: z.number(),
      accessToken: secret().optional(),
    }),
  });

  it('deep-merges nested objects, override winning key-by-key', () => {
    const base = { logLevel: 'info', telemetry: false, gateway: { timeoutMs: 30_000 } };
    const override = { logLevel: 'debug', gateway: { baseUrl: 'https://x.example' } };
    expect(schemaAwareMerge(schema, base, override)).toEqual({
      logLevel: 'debug',
      telemetry: false,
      gateway: { baseUrl: 'https://x.example', timeoutMs: 30_000 },
    });
  });

  it('does not mutate base or override', () => {
    const base = { logLevel: 'info', telemetry: false, gateway: { timeoutMs: 1 } };
    const override = { gateway: { timeoutMs: 2 } };
    const baseCopy = structuredClone(base);
    const overrideCopy = structuredClone(override);
    schemaAwareMerge(schema, base, override);
    expect(base).toEqual(baseCopy);
    expect(override).toEqual(overrideCopy);
  });

  it('treats undefined override as "keep base" but null as an explicit value', () => {
    const base = { logLevel: 'info', telemetry: false, gateway: { timeoutMs: 1 } };
    expect(schemaAwareMerge(schema, base, { logLevel: undefined })).toMatchObject({
      logLevel: 'info',
    });
  });

  describe('replace-wholesale semantics for non-object containers', () => {
    it('REPLACES a discriminated union rather than key-merging its variants', () => {
      const providerSchema = z.object({
        auth: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('none') }),
          z.object({ kind: z.literal('apiKey'), apiKey: secret() }),
          z.object({ kind: z.literal('oauth'), clientId: z.string(), clientSecret: secret() }),
        ]),
      });
      const base = { auth: { kind: 'apiKey', apiKey: { $secret: 'old-key' } } };
      const override = { auth: { kind: 'oauth', clientId: 'c', clientSecret: { $secret: 'cs' } } };
      const merged = schemaAwareMerge(providerSchema, base, override);
      // The apiKey must NOT survive onto the oauth variant.
      expect(merged).toEqual({
        auth: { kind: 'oauth', clientId: 'c', clientSecret: { $secret: 'cs' } },
      });
      expect((merged as { auth: Record<string, unknown> }).auth['apiKey']).toBeUndefined();
    });

    it('REPLACES arrays wholesale (no element-wise merge or concat)', () => {
      const s = z.object({ args: z.array(z.string()) });
      expect(schemaAwareMerge(s, { args: ['a', 'b', 'c'] }, { args: ['x'] })).toEqual({
        args: ['x'],
      });
    });

    it('REPLACES records wholesale so a removed key does not linger', () => {
      const s = z.object({ headers: z.record(z.string(), z.string()) });
      const merged = schemaAwareMerge(s, { headers: { a: '1', b: '2' } }, { headers: { a: '9' } });
      expect(merged).toEqual({ headers: { a: '9' } });
    });

    it('REPLACES a secret marker wholesale (never merges $secret refs)', () => {
      const s = z.object({ token: secret() });
      expect(
        schemaAwareMerge(s, { token: { $secret: 'old' } }, { token: { $secret: 'new' } }),
      ).toEqual({ token: { $secret: 'new' } });
    });

    it('REPLACES a secret marker even when the base marker carries a stale extra key', () => {
      // A secret marker is a branded object; without special handling the merge
      // would deep-merge it and keep the base's stale key. It must not.
      const s = z.object({ token: secret() });
      const merged = schemaAwareMerge(
        s,
        { token: { $secret: 'old', stale: 'leftover' } },
        { token: { $secret: 'new' } },
      );
      expect(merged).toEqual({ token: { $secret: 'new' } });
      expect((merged as { token: Record<string, unknown> }).token['stale']).toBeUndefined();
    });
  });

  it('handles a loose object: unknown keys from both sides survive, override wins', () => {
    const loose = z.looseObject({ enabled: z.boolean() });
    const merged = schemaAwareMerge(
      loose,
      { enabled: true, fromBase: 1, shared: 'base' },
      { enabled: false, fromOverride: 2, shared: 'override' },
    );
    expect(merged).toEqual({
      enabled: false,
      fromBase: 1,
      fromOverride: 2,
      shared: 'override',
    });
  });

  it('deep-merges an unknown nested object under a loose key (plain-object recursion)', () => {
    const loose = z.looseObject({ enabled: z.boolean() });
    const merged = schemaAwareMerge(
      loose,
      { enabled: true, nested: { a: 1, b: 2 } },
      { nested: { b: 3, c: 4 } },
    );
    // Unknown-key nested plain objects still deep-merge (no schema says otherwise).
    expect(merged).toEqual({ enabled: true, nested: { a: 1, b: 3, c: 4 } });
  });

  it('returns override when base is absent', () => {
    const s = z.object({ a: z.number() });
    const absent: unknown = undefined;
    expect(schemaAwareMerge(s, absent, { a: 1 })).toEqual({ a: 1 });
  });

  it('returns base when override is absent', () => {
    const s = z.object({ a: z.number() });
    const absent: unknown = undefined;
    expect(schemaAwareMerge(s, { a: 1 }, absent)).toEqual({ a: 1 });
  });
});
