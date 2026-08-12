import { describe, expect, it } from 'vitest';

import { PLAIN, selectPalette, shouldUseColor } from './colors.js';

describe('shouldUseColor', () => {
  it('honors an explicit true override above everything', () => {
    expect(shouldUseColor(true, false, { NO_COLOR: '1' })).toBe(true);
  });

  it('honors an explicit false override above everything', () => {
    expect(shouldUseColor(false, true, { FORCE_COLOR: '1' })).toBe(false);
  });

  it('disables color when NO_COLOR is set to a non-empty value', () => {
    expect(shouldUseColor(undefined, true, { NO_COLOR: '1' })).toBe(false);
  });

  it('ignores an empty NO_COLOR', () => {
    expect(shouldUseColor(undefined, true, { NO_COLOR: '' })).toBe(true);
  });

  it('enables color when FORCE_COLOR is set even without a TTY', () => {
    expect(shouldUseColor(undefined, false, { FORCE_COLOR: '1' })).toBe(true);
  });

  it('falls back to the TTY flag when no env signals are present', () => {
    expect(shouldUseColor(undefined, true, {})).toBe(true);
    expect(shouldUseColor(undefined, false, {})).toBe(false);
  });
});

describe('selectPalette', () => {
  it('returns the plain palette when color is disabled', () => {
    const palette = selectPalette(false, true, {});
    expect(palette).toBe(PLAIN);
    expect(palette.red('x')).toBe('x');
    expect(palette.bold('x')).toBe('x');
  });

  it('returns a coloring palette when color is enabled', () => {
    const palette = selectPalette(true, false, {});
    // The coloring palette wraps text in ANSI escapes; assert it changed.
    expect(palette.red('x')).not.toBe('x');
    expect(palette.red('x')).toContain('x');
  });

  it('emits the #FFB7C5 truecolor escape for the brand accent', () => {
    const palette = selectPalette(true, false, {});
    // 38;2;R;G;B is the SGR truecolor foreground; 39 resets just the foreground.
    expect(palette.accent('x')).toBe('\u001B[38;2;255;183;197mx\u001B[39m');
  });

  it('leaves the accent as plain text when color is disabled', () => {
    expect(PLAIN.accent('x')).toBe('x');
  });
});
