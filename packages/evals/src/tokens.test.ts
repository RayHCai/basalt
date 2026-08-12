import { describe, expect, it } from 'vitest';

import {
  CONTEXT_LENGTHS,
  estimateTokens,
  formatLength,
  isContextLength,
  parseLength,
} from './tokens.js';

describe('estimateTokens', () => {
  it('is chars/4, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('formatLength', () => {
  it('formats KiB-aligned counts with a K suffix', () => {
    expect(formatLength(8192)).toBe('8K');
    expect(formatLength(32_768)).toBe('32K');
    expect(formatLength(131_072)).toBe('128K');
  });

  it('leaves non-aligned counts as a bare number', () => {
    expect(formatLength(1000)).toBe('1000');
  });
});

describe('parseLength', () => {
  it('parses bare integers', () => {
    expect(parseLength('8192')).toBe(8192);
  });

  it('parses K and M suffixes case-insensitively', () => {
    expect(parseLength('8k')).toBe(8192);
    expect(parseLength('128K')).toBe(131_072);
    expect(parseLength('1m')).toBe(1_048_576);
    expect(parseLength('  32k ')).toBe(32_768);
  });

  it('returns undefined for garbage', () => {
    expect(parseLength('abc')).toBeUndefined();
    expect(parseLength('8kb')).toBeUndefined();
    expect(parseLength('')).toBeUndefined();
  });
});

describe('isContextLength', () => {
  it('recognizes the supported lengths', () => {
    for (const length of CONTEXT_LENGTHS) {
      expect(isContextLength(length)).toBe(true);
    }
    expect(isContextLength(1000)).toBe(false);
  });
});
