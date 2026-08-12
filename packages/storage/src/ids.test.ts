import { describe, expect, it } from 'vitest';

import { assertValidId, isValidId, MAX_ID_LENGTH, newId } from './ids.js';

describe('newId', () => {
  it('mints a v4 UUID', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('mints distinct ids', () => {
    expect(newId()).not.toBe(newId());
  });

  it('mints ids that pass validation', () => {
    expect(isValidId(newId())).toBe(true);
  });
});

describe('assertValidId', () => {
  it('accepts a UUID and returns it unchanged', () => {
    const id = newId();
    expect(assertValidId(id)).toBe(id);
  });

  it('accepts a hand-supplied label (e.g. default-session)', () => {
    expect(assertValidId('default-session')).toBe('default-session');
  });

  it('rejects an empty string', () => {
    expect(() => assertValidId('')).toThrow(TypeError);
  });

  it('rejects path-traversal and separator characters', () => {
    expect(() => assertValidId('../escape')).toThrow();
    expect(() => assertValidId('a/b')).toThrow();
    expect(() => assertValidId(String.raw`a\b`)).toThrow();
    expect(() => assertValidId('a\0b')).toThrow();
  });

  it('rejects whitespace', () => {
    expect(() => assertValidId('a b')).toThrow();
  });

  it('rejects an over-long id', () => {
    expect(() => assertValidId('a'.repeat(MAX_ID_LENGTH + 1))).toThrow(RangeError);
  });

  it('accepts an id at the length limit', () => {
    const id = 'a'.repeat(MAX_ID_LENGTH);
    expect(assertValidId(id)).toBe(id);
  });
});

describe('isValidId', () => {
  it('is the non-throwing form of assertValidId', () => {
    expect(isValidId('abc-123')).toBe(true);
    expect(isValidId('../escape')).toBe(false);
    expect(isValidId('')).toBe(false);
    expect(isValidId(42)).toBe(false);
    expect(isValidId(null)).toBe(false);
    // oxlint-disable-next-line no-useless-undefined -- asserting the guard rejects undefined
    expect(isValidId(undefined)).toBe(false);
  });
});
