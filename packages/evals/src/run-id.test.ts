import { describe, expect, it } from 'vitest';

import { EvalConfigError } from './errors.js';
import { assertValidRunId, formatTimestamp, makeRunId, RUN_ID_PATTERN } from './run-id.js';

// 2026-07-12T17:41:12.123Z
const EPOCH = Date.UTC(2026, 6, 12, 17, 41, 12, 123);

describe('formatTimestamp', () => {
  it('formats a compact UTC slug', () => {
    expect(formatTimestamp(EPOCH)).toBe('20260712T174112');
  });
});

describe('makeRunId', () => {
  it('builds a sortable, slug-safe id', () => {
    const id = makeRunId(EPOCH, 'dummy');
    expect(id).toBe('run-20260712T174112-dummy');
    expect(RUN_ID_PATTERN.test(id)).toBe(true);
  });

  it('slugifies an unfriendly provider name', () => {
    const id = makeRunId(EPOCH, 'weird/../name!');
    expect(RUN_ID_PATTERN.test(id)).toBe(true);
    expect(id.includes('..')).toBe(false);
  });

  it('sorts lexically in chronological order', () => {
    const earlier = makeRunId(EPOCH, 'dummy');
    const later = makeRunId(EPOCH + 60_000, 'dummy');
    expect([later, earlier].toSorted()).toEqual([earlier, later]);
  });
});

describe('assertValidRunId', () => {
  it('accepts a well-formed id', () => {
    expect(() => assertValidRunId('run-20260712T174112-dummy')).not.toThrow();
  });

  it('rejects path traversal and illegal characters', () => {
    expect(() => assertValidRunId('../escape')).toThrow(EvalConfigError);
    expect(() => assertValidRunId('a/b')).toThrow(EvalConfigError);
    expect(() => assertValidRunId('')).toThrow(EvalConfigError);
    expect(() => assertValidRunId('has space')).toThrow(EvalConfigError);
  });
});
