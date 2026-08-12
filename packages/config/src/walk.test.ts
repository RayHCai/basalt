import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { secret } from './secret-field.js';
import { collectSecretPaths, mapSecrets } from './walk.js';

/** A schema exercising every container the walker must descend. */
const schema = z.object({
  enabled: z.boolean(),
  apiKey: secret(),
  optionalKey: secret().optional(),
  auth: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('apiKey'), token: secret() }),
    z.object({
      kind: z.literal('harness'),
      command: z.string(),
      env: z.record(z.string(), secret()),
    }),
  ]),
  headers: z.record(z.string(), z.string()),
  extras: z.array(z.object({ value: secret() })),
});

describe('collectSecretPaths', () => {
  it('finds the top-level secret and skips ordinary fields', () => {
    const paths = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      auth: { kind: 'none' },
      headers: { 'x-h': 'v' },
      extras: [],
    });
    expect(paths).toEqual([['apiKey']]);
  });

  it('descends into the SELECTED discriminated-union branch only', () => {
    const paths = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      auth: { kind: 'apiKey', token: 't' },
      headers: {},
      extras: [],
    });
    expect(paths).toContainEqual(['apiKey']);
    expect(paths).toContainEqual(['auth', 'token']);
  });

  it('walks a record of secrets, one path per present key', () => {
    const paths = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      auth: { kind: 'harness', command: 'run', env: { A: '1', B: '2' } },
      headers: {},
      extras: [],
    });
    expect(paths).toContainEqual(['auth', 'env', 'A']);
    expect(paths).toContainEqual(['auth', 'env', 'B']);
    // headers is a record of plain strings — never reported.
    expect(paths.some((p) => p[0] === 'headers')).toBe(false);
  });

  it('walks arrays by index', () => {
    const paths = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      auth: { kind: 'none' },
      headers: {},
      extras: [{ value: 'x' }, { value: 'y' }],
    });
    expect(paths).toContainEqual(['extras', 0, 'value']);
    expect(paths).toContainEqual(['extras', 1, 'value']);
  });

  it('includes an optional secret only when present in the value', () => {
    const withOpt = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      optionalKey: 'o',
      auth: { kind: 'none' },
      headers: {},
      extras: [],
    });
    expect(withOpt).toContainEqual(['optionalKey']);

    const withoutOpt = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      auth: { kind: 'none' },
      headers: {},
      extras: [],
    });
    expect(withoutOpt.some((p) => p[0] === 'optionalKey')).toBe(false);
  });

  it('tolerates loose-object unknown keys (no schema) without crashing', () => {
    const loose = z.looseObject({ known: secret() });
    const paths = collectSecretPaths(loose, { known: 'k', surprise: { nested: 'value' } });
    expect(paths).toEqual([['known']]);
  });

  it('handles a value that does not match any union branch by reporting nothing there', () => {
    const paths = collectSecretPaths(schema, {
      enabled: true,
      apiKey: 'a',
      auth: { kind: 'unknown-kind', token: 'leak?' },
      headers: {},
      extras: [],
    });
    // The unmatched branch cannot be classified, so its inner value is not
    // reported as a secret path (fail-closed: better to miss than mislabel).
    expect(paths).toEqual([['apiKey']]);
  });
});

describe('mapSecrets', () => {
  it('replaces exactly the secret leaves, leaving the rest structurally intact', () => {
    const input = {
      enabled: true,
      apiKey: 'SECRET_A',
      auth: { kind: 'harness', command: 'run', env: { TOKEN: 'SECRET_B' } },
      headers: { 'x-h': 'plain' },
      extras: [{ value: 'SECRET_C' }],
    };
    const out = mapSecrets(schema, input, (value, path) => `<${path.join('.')}=${String(value)}>`);
    expect(out).toEqual({
      enabled: true,
      apiKey: '<apiKey=SECRET_A>',
      auth: { kind: 'harness', command: 'run', env: { TOKEN: '<auth.env.TOKEN=SECRET_B>' } },
      headers: { 'x-h': 'plain' },
      extras: [{ value: '<extras.0.value=SECRET_C>' }],
    });
    // The original input is not mutated.
    expect(input.apiKey).toBe('SECRET_A');
  });

  it('leaves a document unchanged when it has no secrets', () => {
    const plain = z.object({ a: z.string(), b: z.number() });
    const input = { a: 'x', b: 1 };
    expect(mapSecrets(plain, input, () => 'NOPE')).toEqual({ a: 'x', b: 1 });
  });
});
