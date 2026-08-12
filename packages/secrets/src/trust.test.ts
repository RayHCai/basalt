import { describe, expect, it } from 'vitest';

import {
  assertTrustedContext,
  isUntrustedContext,
  SecretAccessDeniedError,
  UNTRUSTED_ENV_VAR,
} from './trust.js';

describe('trust', () => {
  it('treats a clean environment as trusted', () => {
    expect(isUntrustedContext({})).toBe(false);
    expect(isUntrustedContext({ PATH: '/usr/bin' })).toBe(false);
  });

  it('treats the untrusted flag (any truthy string) as untrusted', () => {
    expect(isUntrustedContext({ [UNTRUSTED_ENV_VAR]: '1' })).toBe(true);
    expect(isUntrustedContext({ [UNTRUSTED_ENV_VAR]: 'true' })).toBe(true);
    expect(isUntrustedContext({ [UNTRUSTED_ENV_VAR]: 'yes' })).toBe(true);
  });

  it('ignores an explicit falsey flag value', () => {
    expect(isUntrustedContext({ [UNTRUSTED_ENV_VAR]: '' })).toBe(false);
    expect(isUntrustedContext({ [UNTRUSTED_ENV_VAR]: '0' })).toBe(false);
    expect(isUntrustedContext({ [UNTRUSTED_ENV_VAR]: 'false' })).toBe(false);
  });

  it('assertTrustedContext throws in an untrusted context', () => {
    expect(() => assertTrustedContext('decrypt', { [UNTRUSTED_ENV_VAR]: '1' })).toThrow(
      SecretAccessDeniedError,
    );
  });

  it('assertTrustedContext is a no-op in a trusted context', () => {
    expect(() => assertTrustedContext('decrypt', {})).not.toThrow();
  });

  it('the denial error names the attempted operation but not any value', () => {
    // oxlint-disable-next-line init-declarations
    let caught: unknown;
    try {
      assertTrustedContext('resolveKey', { [UNTRUSTED_ENV_VAR]: '1' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecretAccessDeniedError);
    expect((caught as SecretAccessDeniedError).operation).toBe('resolveKey');
    expect((caught as Error).message).toContain('resolveKey');
    expect((caught as Error).message).toContain('untrusted');
  });
});
