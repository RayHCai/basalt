import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVEL, isLogLevel, LEVEL_ENV_VAR, LEVELS, resolveLevel } from './levels.js';

describe('levels', () => {
  it('orders levels least → most severe with silent last', () => {
    expect(LEVELS).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'silent']);
  });

  it('recognizes valid level names and rejects everything else', () => {
    for (const level of LEVELS) {
      expect(isLogLevel(level)).toBe(true);
    }
    expect(isLogLevel('fatal')).toBe(false);
    expect(isLogLevel('INFO')).toBe(false);
    expect(isLogLevel('')).toBe(false);
    expect(isLogLevel(3)).toBe(false);
    const missing: unknown = undefined;
    expect(isLogLevel(missing)).toBe(false);
  });

  describe('resolveLevel', () => {
    it('prefers an explicit valid level over env and default', () => {
      expect(resolveLevel('debug', { [LEVEL_ENV_VAR]: 'error' })).toBe('debug');
    });

    it('falls back to the env var when no explicit level is given', () => {
      expect(resolveLevel(undefined, { [LEVEL_ENV_VAR]: 'warn' })).toBe('warn');
    });

    it('falls back to the default when neither is set', () => {
      expect(resolveLevel(undefined, {})).toBe(DEFAULT_LEVEL);
    });

    it('ignores an unrecognized env value rather than disabling logging', () => {
      expect(resolveLevel(undefined, { [LEVEL_ENV_VAR]: 'loud' })).toBe(DEFAULT_LEVEL);
    });

    it('ignores an invalid explicit level and considers env next', () => {
      // @ts-expect-error exercising runtime guard with a bad value
      expect(resolveLevel('nope', { [LEVEL_ENV_VAR]: 'trace' })).toBe('trace');
    });
  });
});
