import { KEY_ENV_VAR } from './key.js';
import type { Env } from './paths.js';
import { UNTRUSTED_ENV_VAR } from './trust.js';

/**
 * Minimal set of environment variables safe to inherit into an untrusted child
 * (the agent sandbox). Deliberately conservative: enough for a shell/tool to
 * function, nothing that carries credentials or host identity beyond the basics.
 * Callers extend this per session via {@link ScrubOptions.allow}.
 */
const DEFAULT_ALLOW: readonly string[] = [
  'PATH',
  'HOME',
  'PWD',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TZ',
];

/**
 * Names that must NEVER cross into an untrusted child, even if a caller
 * allowlists them (a too-broad allow is a common mistake). This is a hard deny
 * that wins over {@link ScrubOptions.allow}. Matches — case-insensitively:
 *
 *   - anything starting `AWS_` (access key id, secret, session token, …);
 *   - anything ending, on an underscore/name boundary, in a secret-bearing word
 *     (`TOKEN`, `PASSWORD`, `SECRET`, `KEY`, `CREDENTIAL(S)`, `AUTH`, …) — which
 *     covers `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`, the gap
 *     OpenClaw's denylist left open, plus `GH_TOKEN`, `NPM_TOKEN`, etc.
 *
 * The boundary (`(^|_)`) keeps false positives out: `TOKENIZER`, `KEYBOARD`,
 * `DONKEY` do not match.
 */
const SENSITIVE_KEY_PATTERN =
  /^AWS_|(?:^|_)(?:TOKENS?|PASSWORD|PASSWD|PASSPHRASE|SECRETS?|KEY|CREDENTIALS?|AUTH)$/iu;

/** `true` when `key` names a variable that must never reach an untrusted child. */
function isSensitiveKey(key: string): boolean {
  // Explicit hard-deny for the basalt master key regardless of pattern drift.
  if (key.toUpperCase() === KEY_ENV_VAR.toUpperCase()) {
    return true;
  }
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Options for {@link scrubEnvironment}. */
interface ScrubOptions {
  /**
   * Extra variable names to inherit from the source, on top of
   * {@link DEFAULT_ALLOW}. A name here is still dropped if it is sensitive.
   */
  allow?: readonly string[];
  /**
   * Variables to place explicitly into the result — the scoped-injection path
   * (e.g. a single short-lived provider key minted for a 3rd-party harness).
   * These are DELIBERATE and win over scrubbing, so the caller owns the risk.
   * Applied last, so they also override {@link markUntrusted}.
   */
  inject?: Readonly<Record<string, string>>;
  /**
   * Set `BASALT_UNTRUSTED=1` in the result (default `true`). Defense-in-depth
   * only — see {@link UNTRUSTED_ENV_VAR}.
   */
  markUntrusted?: boolean;
}

/**
 * Build the environment an untrusted child process (the agent sandbox) should
 * be spawned with, from a source environment (typically the trusted parent's
 * `process.env`).
 *
 * Default-DENY: only variables in {@link DEFAULT_ALLOW} plus `options.allow`
 * survive, and any {@link isSensitiveKey} name is dropped even if allowlisted.
 * The source is never mutated; the result is a plain `string → string` record
 * ready to hand to `child_process.spawn`'s `env`.
 *
 * This is the mechanism behind the real agent↔secret boundary: the agent is
 * born into a world that contains neither the stored secrets nor the master key
 * ({@link KEY_ENV_VAR}), so there is nothing to read or "bypass". Secrets reach
 * a session only through the trusted broker afterwards.
 */
function scrubEnvironment(
  source: Env = process.env,
  options: ScrubOptions = {},
): Record<string, string> {
  const allow = new Set<string>([...DEFAULT_ALLOW, ...(options.allow ?? [])]);
  const result: Record<string, string> = {};

  for (const key of allow) {
    const value = source[key];
    if (!isSensitiveKey(key) && typeof value === 'string') {
      result[key] = value;
    }
  }

  if (options.markUntrusted ?? true) {
    result[UNTRUSTED_ENV_VAR] = '1';
  }

  if (options.inject !== undefined) {
    for (const [key, value] of Object.entries(options.inject)) {
      result[key] = value;
    }
  }

  return result;
}

export { DEFAULT_ALLOW, isSensitiveKey, scrubEnvironment, type ScrubOptions };
