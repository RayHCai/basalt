import { describe, expect, it } from 'vitest';

import { assertValidName, isValidName, MAX_NAME_LENGTH } from './names.js';

describe('isValidName', () => {
  it('accepts lowercase alphanumerics and hyphens starting with alphanumeric', () => {
    for (const ok of ['a', 'anthropic', 'gpt-4o', 'x0', '0a', 'a-b-c']) {
      expect(isValidName(ok)).toBe(true);
    }
  });

  it('rejects traversal, separators, casing, and empties', () => {
    const backslash = String.raw`a\b`;
    for (const bad of [
      '',
      '..',
      '.',
      '-leading',
      'UPPER',
      'has space',
      'a/b',
      backslash,
      'a.b',
      'a\0b',
    ]) {
      expect(isValidName(bad)).toBe(false);
    }
  });

  it('permits a trailing hyphen, matching the @basalt/secrets name shape', () => {
    // The pattern is kept in lockstep with @basalt/secrets; both allow this.
    expect(isValidName('trailing-')).toBe(true);
  });

  it('rejects non-strings', () => {
    const missing: unknown = undefined;
    expect(isValidName(missing)).toBe(false);
    expect(isValidName(42)).toBe(false);
    expect(isValidName(null)).toBe(false);
  });

  it('enforces the max length', () => {
    expect(isValidName('a'.repeat(MAX_NAME_LENGTH))).toBe(true);
    expect(isValidName('a'.repeat(MAX_NAME_LENGTH + 1))).toBe(false);
  });
});

describe('assertValidName', () => {
  it('returns the name unchanged when valid', () => {
    expect(assertValidName('anthropic')).toBe('anthropic');
  });

  it('throws a descriptive error for a bad name', () => {
    expect(() => assertValidName('../etc')).toThrow(/Invalid config section name/u);
  });

  it('throws for an over-long name', () => {
    expect(() => assertValidName('a'.repeat(MAX_NAME_LENGTH + 1))).toThrow(/exceeds/u);
  });

  it('throws for an empty name', () => {
    expect(() => assertValidName('')).toThrow(/non-empty/u);
  });
});
