import type { Env } from './paths.js';

/**
 * Environment variable marking the current context as untrusted (e.g. one that
 * hosts the agent loop). When present and truthy, the secret store refuses
 * every operation that could reveal or persist secret material.
 *
 * IMPORTANT — this is defense-in-depth, NOT the security boundary. A hostile
 * in-process agent can simply `delete process.env.BASALT_UNTRUSTED`, so this
 * flag cannot keep secrets from an adversary that shares this process. Its real
 * jobs are:
 *
 *   - catch a `SecretStore` / key operation that TRUSTED code accidentally runs
 *     in a context that should not have secrets (a mis-scoped worker, an in-proc
 *     plugin) — turning a silent leak into a loud throw;
 *   - make a leaked handle fail loudly in tests.
 *
 * The actual boundary is architectural and lives outside this package: the
 * agent runs in a separate OS process/container (see `sandbox`), spawned with a
 * scrubbed environment ({@link scrubEnvironment}) that contains neither the
 * secrets nor `BASALT_SECRETS_KEY`, and with no filesystem path to the store.
 * Secrets reach a session only through the trusted broker (`runtime`), which
 * performs or authorizes the secret-touching step and returns results — the raw
 * value never crosses into the sandbox in the common case. Trust is a property
 * of WHERE code runs, enforced by the OS; this flag is only a seatbelt.
 */
const UNTRUSTED_ENV_VAR = 'BASALT_UNTRUSTED';

/** Values that, if seen in {@link UNTRUSTED_ENV_VAR}, do NOT mark untrust. */
const FALSEY: ReadonlySet<string> = new Set(['', '0', 'false', 'no', 'off']);

/**
 * `true` when the current context is marked untrusted. Fails safe: any value
 * that is not explicitly falsey (case-insensitive) counts as untrusted, so a
 * misconfigured caller errs toward denying access rather than granting it.
 * (Defense-in-depth only — see {@link UNTRUSTED_ENV_VAR}.)
 */
function isUntrustedContext(env: Env = process.env): boolean {
  const flag = env[UNTRUSTED_ENV_VAR];
  if (typeof flag !== 'string') {
    return false;
  }
  return !FALSEY.has(flag.trim().toLowerCase());
}

/** Sensitive operations the trust gate guards. */
type GuardedOperation = 'resolveKey' | 'decrypt' | 'encrypt' | 'read' | 'write' | 'expose';

/**
 * Raised when secret material is requested from a context flagged untrusted.
 * Deliberately carries no value — only the attempted operation name — so the
 * error itself is safe to log.
 */
class SecretAccessDeniedError extends Error {
  readonly operation: GuardedOperation;

  constructor(operation: GuardedOperation) {
    super(
      `Secret operation "${operation}" is not permitted from a context flagged ` +
        `untrusted (${UNTRUSTED_ENV_VAR}).`,
    );
    this.name = 'SecretAccessDeniedError';
    this.operation = operation;
  }
}

/**
 * Throw {@link SecretAccessDeniedError} if the current context is flagged
 * untrusted. Trusted callers pass through. Defense-in-depth (see
 * {@link UNTRUSTED_ENV_VAR}): a cheap env check on each sensitive operation to
 * turn an accidental in-context access into a loud failure — not a barrier
 * against a hostile in-process adversary, which can clear the flag.
 */
function assertTrustedContext(operation: GuardedOperation, env: Env = process.env): void {
  if (isUntrustedContext(env)) {
    throw new SecretAccessDeniedError(operation);
  }
}

export { assertTrustedContext, isUntrustedContext, SecretAccessDeniedError, UNTRUSTED_ENV_VAR };
