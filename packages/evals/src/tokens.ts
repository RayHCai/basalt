/**
 * Token accounting for eval generation and instrumentation.
 *
 * RULER task lengths are specified in tokens (8K / 32K / 128K), and the
 * instrumentation reports token usage per task. Neither needs a real tokenizer:
 * generation only needs a monotonic, model-agnostic estimate to grow a haystack
 * to a target size, and instrumentation records whatever counts the model
 * provider reports (falling back to the same estimate when a provider — like the
 * dummy — reports none).
 *
 * The estimate is the widely-used chars/4 heuristic. It is intentionally simple
 * and deterministic; when a provider surfaces real usage, that always wins.
 */

/** The named context lengths RULER samples are generated at. */
const CONTEXT_LENGTHS = [8192, 32_768, 131_072] as const;

/** One of the supported RULER context lengths, in tokens. */
type ContextLength = (typeof CONTEXT_LENGTHS)[number];

/** Average characters per token used by the {@link estimateTokens} heuristic. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count of `text` with the chars/4 heuristic. Deterministic
 * and model-agnostic — good enough to grow a haystack to a target size and to
 * stand in when a provider reports no usage. Never negative; empty text is 0.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Format a token count as a short human label: `8192` → `8K`, `131072` → `128K`. */
function formatLength(tokens: number): string {
  if (tokens % 1024 === 0) {
    return `${(tokens / 1024).toString()}K`;
  }
  return tokens.toString();
}

/**
 * Parse a length label back to a token count. Accepts a bare integer
 * (`"8192"`) or a `K`/`M` suffix (`"8k"`, `"128K"`, `"1m"`), case-insensitive.
 * Returns `undefined` for anything unparseable so callers can report a clear
 * usage error rather than proceeding with `NaN`.
 */
function parseLength(label: string): number | undefined {
  const match = /^(?<value>\d+)\s*(?<suffix>[km]?)$/iu.exec(label.trim());
  if (match === null) {
    return undefined;
  }
  const value = Number(match.groups?.['value']);
  const suffix = (match.groups?.['suffix'] ?? '').toLowerCase();
  if (suffix === 'k') {
    return value * 1024;
  }
  if (suffix === 'm') {
    return value * 1024 * 1024;
  }
  return value;
}

/** Type guard: `value` is one of the supported {@link CONTEXT_LENGTHS}. */
function isContextLength(value: number): value is ContextLength {
  return (CONTEXT_LENGTHS as readonly number[]).includes(value);
}

export {
  CONTEXT_LENGTHS,
  type ContextLength,
  estimateTokens,
  formatLength,
  isContextLength,
  parseLength,
};
