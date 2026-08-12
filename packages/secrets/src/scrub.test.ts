import { describe, expect, it } from 'vitest';

import { DEFAULT_ALLOW, isSensitiveKey, scrubEnvironment } from './scrub.js';
import { KEY_ENV_VAR } from './key.js';
import { UNTRUSTED_ENV_VAR } from './trust.js';

describe('isSensitiveKey', () => {
  it('flags provider API keys (the gap OpenClaw left open)', () => {
    expect(isSensitiveKey('ANTHROPIC_API_KEY')).toBe(true);
    expect(isSensitiveKey('OPENAI_API_KEY')).toBe(true);
    expect(isSensitiveKey('GEMINI_API_KEY')).toBe(true);
  });

  it('flags generic secret-bearing names by suffix', () => {
    expect(isSensitiveKey('GH_TOKEN')).toBe(true);
    expect(isSensitiveKey('NPM_TOKEN')).toBe(true);
    expect(isSensitiveKey('DB_PASSWORD')).toBe(true);
    expect(isSensitiveKey('MY_SECRET')).toBe(true);
    expect(isSensitiveKey('SESSION_KEY')).toBe(true);
    expect(isSensitiveKey('SOME_CREDENTIAL')).toBe(true);
    expect(isSensitiveKey('AUTH_TOKEN')).toBe(true);
  });

  it('flags cloud provider credential prefixes', () => {
    expect(isSensitiveKey('AWS_ACCESS_KEY_ID')).toBe(true);
    expect(isSensitiveKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSensitiveKey('AWS_SESSION_TOKEN')).toBe(true);
  });

  it('flags the basalt master key env var', () => {
    expect(isSensitiveKey(KEY_ENV_VAR)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSensitiveKey('anthropic_api_key')).toBe(true);
    expect(isSensitiveKey('Db_Password')).toBe(true);
  });

  it('does not flag ordinary variables', () => {
    expect(isSensitiveKey('PATH')).toBe(false);
    expect(isSensitiveKey('HOME')).toBe(false);
    expect(isSensitiveKey('LANG')).toBe(false);
    expect(isSensitiveKey('TERM')).toBe(false);
    // "TOKENIZER" ends in a word, not the TOKEN suffix boundary.
    expect(isSensitiveKey('TOKENIZER')).toBe(false);
    expect(isSensitiveKey('KEYBOARD_LAYOUT')).toBe(false);
  });
});

describe('scrubEnvironment', () => {
  it('drops everything not in the allowlist (default-deny)', () => {
    const out = scrubEnvironment(
      { PATH: '/usr/bin', RANDOM_TOOL_CONFIG: 'x', ANOTHER_VAR: 'y' },
      { allow: ['PATH'], markUntrusted: false },
    );
    expect(out).toEqual({ PATH: '/usr/bin' });
  });

  it('passes through the built-in default-allow vars without an explicit allow', () => {
    const source = { PATH: '/usr/bin', HOME: '/home/a', LANG: 'en', SNEAKY: 'v' };
    const out = scrubEnvironment(source);
    for (const key of DEFAULT_ALLOW) {
      if (key in source) {
        expect(out[key]).toBe(source[key as keyof typeof source]);
      }
    }
    expect(out).not.toHaveProperty('SNEAKY');
  });

  it('never passes a sensitive var even if the caller allowlists it', () => {
    const out = scrubEnvironment(
      { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-leak', GH_TOKEN: 't' },
      { allow: ['PATH', 'ANTHROPIC_API_KEY', 'GH_TOKEN'], markUntrusted: false },
    );
    expect(out).toEqual({ PATH: '/usr/bin' });
    expect(JSON.stringify(out)).not.toContain('sk-leak');
  });

  it('strips the master key env var', () => {
    const out = scrubEnvironment(
      { PATH: '/usr/bin', [KEY_ENV_VAR]: 'base64key' },
      { allow: ['PATH', KEY_ENV_VAR] },
    );
    expect(out).not.toHaveProperty(KEY_ENV_VAR);
  });

  it('sets BASALT_UNTRUSTED=1 in the scrubbed env by default', () => {
    const out = scrubEnvironment({ PATH: '/usr/bin' });
    expect(out[UNTRUSTED_ENV_VAR]).toBe('1');
  });

  it('can opt out of marking untrusted', () => {
    const out = scrubEnvironment({ PATH: '/usr/bin' }, { markUntrusted: false });
    expect(out).not.toHaveProperty(UNTRUSTED_ENV_VAR);
  });

  it('injects explicit extra vars (scoped injection path)', () => {
    const out = scrubEnvironment(
      { PATH: '/usr/bin' },
      { inject: { ANTHROPIC_API_KEY: 'sk-scoped' } },
    );
    expect(out['ANTHROPIC_API_KEY']).toBe('sk-scoped');
    expect(out['PATH']).toBe('/usr/bin');
  });

  it('injection wins over scrubbing (deliberate, scoped)', () => {
    const out = scrubEnvironment(
      { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-inherited' },
      { inject: { ANTHROPIC_API_KEY: 'sk-scoped' } },
    );
    // The inherited one is scrubbed; the injected one is deliberately placed.
    expect(out['ANTHROPIC_API_KEY']).toBe('sk-scoped');
  });

  it('ignores undefined source values', () => {
    const out = scrubEnvironment({ PATH: undefined, HOME: '/home/a' });
    expect(out).not.toHaveProperty('PATH');
  });

  it('never mutates the source environment', () => {
    const source = { PATH: '/usr/bin', GH_TOKEN: 't' };
    const snapshot = { ...source };
    scrubEnvironment(source, { inject: { X: 'y' } });
    expect(source).toEqual(snapshot);
  });

  it('produces a string→string record (spawn-ready)', () => {
    const out = scrubEnvironment({ PATH: '/usr/bin' });
    for (const value of Object.values(out)) {
      expect(typeof value).toBe('string');
    }
  });
});
