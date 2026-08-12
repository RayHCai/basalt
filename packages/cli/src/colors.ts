import { createColors } from 'picocolors';

// Force an always-on coloring instance. picocolors' default export auto-detects
// TTY support at import time, so it would emit plain text in a non-TTY context
// (pipes, CI, test runners) regardless of our own decision. We make the
// enable/disable choice ourselves in `selectPalette`, so the color instance
// must be unconditional.
const pc = createColors(true);

/**
 * The subset of picocolors styling functions the CLI uses. Kept small and
 * explicit so output styling stays consistent and easy to audit. Each is a
 * `(text) => text` transform.
 */
interface Palette {
  bold: (text: string) => string;
  dim: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  green: (text: string) => string;
  cyan: (text: string) => string;
  magenta: (text: string) => string;
  /** Muted stone gray for chrome/hints in the interactive prompt. */
  gray: (text: string) => string;
  /**
   * Basalt's brand accent — cherry-blossom pink (#FFB7C5), used for the REPL
   * banner wordmark and prompt marker. This is a 24-bit truecolor shade, which
   * picocolors cannot express, so it is emitted as a raw ANSI escape (see
   * {@link accent}). Terminals without truecolor support degrade it to their
   * nearest color; those without any color get the plain text via {@link PLAIN}.
   */
  accent: (text: string) => string;
}

/** A no-op transform used when color is disabled. */
const identity = (text: string): string => text;

/**
 * Wrap `text` in a 24-bit truecolor foreground escape for #FFB7C5
 * (cherry-blossom pink). `\u001B[38;2;R;G;Bm` sets the foreground; `\u001B[39m`
 * resets just the foreground so surrounding styles (bold, etc.) are untouched.
 */
const accentTrueColor = (text: string): string => `\u001B[38;2;255;183;197m${text}\u001B[39m`;

/** Palette that emits ANSI codes (real picocolors functions). */
const COLOR: Palette = {
  bold: pc.bold,
  dim: pc.dim,
  red: pc.red,
  yellow: pc.yellow,
  green: pc.green,
  cyan: pc.cyan,
  magenta: pc.magenta,
  gray: pc.gray,
  accent: accentTrueColor,
};

/** Palette that leaves text untouched — for pipes, `NO_COLOR`, or `--no-color`. */
const PLAIN: Palette = {
  bold: identity,
  dim: identity,
  red: identity,
  yellow: identity,
  green: identity,
  cyan: identity,
  magenta: identity,
  gray: identity,
  accent: identity,
};

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Decide whether to emit color. Precedence:
 *   1. explicit `override` (from `--color` / `--no-color`)
 *   2. `NO_COLOR` env var (any non-empty value disables — see no-color.org)
 *   3. `FORCE_COLOR` env var (any non-empty value enables)
 *   4. the stream being a TTY
 */
function shouldUseColor(
  override: boolean | undefined,
  isTty: boolean,
  env: Env = process.env,
): boolean {
  if (override !== undefined) {
    return override;
  }
  const noColor = env['NO_COLOR'];
  if (typeof noColor === 'string' && noColor.length > 0) {
    return false;
  }
  const forceColor = env['FORCE_COLOR'];
  if (typeof forceColor === 'string' && forceColor.length > 0) {
    return true;
  }
  return isTty;
}

/**
 * Resolve the palette to use given an explicit override, whether the target
 * stream is a TTY, and the environment.
 */
function selectPalette(
  override: boolean | undefined,
  isTty: boolean,
  env: Env = process.env,
): Palette {
  return shouldUseColor(override, isTty, env) ? COLOR : PLAIN;
}

export { type Palette, PLAIN, selectPalette, shouldUseColor };
