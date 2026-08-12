import type { Secret } from '@basalt/secrets';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  isSecretField,
  isSecretRef,
  makeSecretRef,
  SECRET_MARKER_KEY,
  secret,
} from './secret-field.js';
import type {
  RedactSecrets,
  ResolveSecrets,
  SecretInput,
  SecretInputs,
  SecretRef,
} from './secret-field.js';

describe('secret() schema', () => {
  it('is tagged as a secret via zod meta so the walker can find it', () => {
    expect(isSecretField(secret())).toBe(true);
    expect(isSecretField(z.string())).toBe(false);
    expect(isSecretField(z.object({ a: z.string() }))).toBe(false);
  });

  it('validates the on-disk marker shape', () => {
    const schema = z.object({ apiKey: secret() });
    expect(schema.parse({ apiKey: { $secret: 'ref-1' } })).toEqual({
      apiKey: { $secret: 'ref-1' },
    });
  });

  it('rejects a bare string (secrets are stored as markers, never inline)', () => {
    expect(() => secret().parse('sk-live-plaintext')).toThrow();
  });

  it('rejects a marker with an empty ref', () => {
    expect(() => secret().parse({ $secret: '' })).toThrow();
  });

  it('survives wrapping (optional) and stays detectable through the wrapper', () => {
    const opt = secret().optional();
    // Detection through a wrapper is the walker's job; here we assert the inner
    // schema still carries the tag.
    expect(isSecretField(opt.unwrap())).toBe(true);
  });
});

describe('SecretRef helpers', () => {
  it('makeSecretRef builds a marker under the reserved key', () => {
    expect(makeSecretRef('a.b.c')).toEqual({ [SECRET_MARKER_KEY]: 'a.b.c' });
    expect(SECRET_MARKER_KEY).toBe('$secret');
  });

  it('isSecretRef recognizes only genuine markers', () => {
    expect(isSecretRef({ $secret: 'x' })).toBe(true);
    // A shape guard, not a validity check: an empty ref still has the shape.
    expect(isSecretRef({ $secret: '' })).toBe(true);
    expect(isSecretRef({ other: 'x' })).toBe(false);
    expect(isSecretRef('x')).toBe(false);
    expect(isSecretRef(null)).toBe(false);
    expect(isSecretRef({ $secret: 5 })).toBe(false);
  });
});

describe('type-level secret mapping', () => {
  interface Stored {
    enabled: boolean;
    apiKey: SecretRef;
    optionalKey?: SecretRef;
    headers: Record<string, string>;
    envSecrets: Record<string, SecretRef>;
    nested: { token: SecretRef; name: string };
  }

  it('ResolveSecrets turns SecretRef into Secret, leaving other fields intact', () => {
    expectTypeOf<ResolveSecrets<Stored>['apiKey']>().toEqualTypeOf<Secret>();
    expectTypeOf<ResolveSecrets<Stored>['optionalKey']>().toEqualTypeOf<Secret | undefined>();
    expectTypeOf<ResolveSecrets<Stored>['enabled']>().toEqualTypeOf<boolean>();
    expectTypeOf<ResolveSecrets<Stored>['headers']>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<ResolveSecrets<Stored>['envSecrets']>().toEqualTypeOf<Record<string, Secret>>();
    expectTypeOf<ResolveSecrets<Stored>['nested']['token']>().toEqualTypeOf<Secret>();
    expectTypeOf<ResolveSecrets<Stored>['nested']['name']>().toEqualTypeOf<string>();
  });

  it('RedactSecrets turns SecretRef into a plain string (the placeholder)', () => {
    expectTypeOf<RedactSecrets<Stored>['apiKey']>().toEqualTypeOf<string>();
    expectTypeOf<RedactSecrets<Stored>['envSecrets']>().toEqualTypeOf<Record<string, string>>();
  });

  it('SecretInputs accepts plaintext string or a Secret box for secret fields', () => {
    expectTypeOf<SecretInputs<Stored>['apiKey']>().toEqualTypeOf<SecretInput>();
    expectTypeOf<SecretInputs<Stored>['enabled']>().toEqualTypeOf<boolean>();
  });
});
