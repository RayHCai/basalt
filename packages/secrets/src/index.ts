/**
 * `@basalt/secrets` — safe handling, storage, and retrieval of env vars, tokens,
 * and other sensitive values for the Basalt runtime. This is the TRUSTED-SIDE
 * storage engine; it is not, by itself, the agent↔secret boundary (see below).
 *
 * ## Threat model
 *
 * The model/agent is NOT a trusted principal. But no in-process software trick
 * keeps a secret from code that shares the process: if the agent can read the
 * key and the ciphertext, it can decrypt; if it can write `process.env`, it can
 * clear any flag. The real boundary is therefore ARCHITECTURAL and enforced by
 * the OS, not by this library:
 *
 *   - the agent loop runs in a separate OS process / container (`sandbox`),
 *     spawned with a scrubbed environment ({@link scrubEnvironment}) holding
 *     neither the secrets nor `BASALT_SECRETS_KEY`, and with no filesystem path
 *     to the encrypted store;
 *   - secrets reach a session only through the trusted broker (`runtime`),
 *     which performs or authorizes the secret-touching step and returns results
 *     — the raw value never crosses into the sandbox in the common case.
 *
 * ## What this package provides
 *
 * 1. **Redaction box** — every secret is a {@link Secret}, revealing its value
 *    only through an explicit `.expose()`. Renders as `[redacted]` under
 *    `String`, `JSON.stringify`, `util.inspect`/`console`, and carries no value
 *    across a `structuredClone` (worker `postMessage`) boundary — so a secret
 *    cannot leak by ACCIDENT into a log or a serialized message.
 * 2. **Encryption at rest** — values are sealed with AES-256-GCM under a 256-bit
 *    master key (env `BASALT_SECRETS_KEY`, or a `0600` keyfile), the name bound
 *    as authenticated data. Plaintext never touches disk. This defends the
 *    ciphertext leaving the machine (backups, crash dumps, sync, telemetry) and
 *    a disk-only key holder, NOT a co-resident agent that can read the key.
 * 3. **Environment scrubbing** — {@link scrubEnvironment} produces the
 *    default-deny child environment the sandbox spawns the agent with.
 * 4. **Trust gate** — {@link assertTrustedContext} / `BASALT_UNTRUSTED`.
 *    DEFENSE-IN-DEPTH ONLY: it turns an accidental in-context access into a loud
 *    throw and makes a leaked handle fail in tests. A hostile in-process agent
 *    can clear the flag; it is a seatbelt, not the wall.
 *
 * The intended consumers are `@basalt/config` (routes sensitive config values
 * through {@link createSecretStore}) and `@basalt/runtime` (the broker + sandbox
 * env). This package depends on nothing internal and, deliberately, does no
 * logging — secret material never reaches a log sink from here.
 *
 * ```ts
 * import { createSecretStore } from '@basalt/secrets';
 * // `dir` is required — the caller (`@basalt/config`) owns where state lives.
 * const secrets = await createSecretStore({ dir: '/path/to/state/secrets' });
 * await secrets.set('gateway-token', process.env.TOKEN!);
 * const token = await secrets.require('gateway-token');
 * fetch(url, { headers: { authorization: `Bearer ${token.expose()}` } });
 * ```
 */
export { KEY_BYTES, type SealedBox } from './crypto.js';
export { KEY_ENV_VAR, resolveMasterKey } from './key.js';
export { assertValidName, isValidName, MAX_NAME_LENGTH } from './names.js';
export { type Env, KEY_FILE_NAME, keyFile, STORE_FILE_NAME, storeFile } from './paths.js';
export { DEFAULT_ALLOW, isSensitiveKey, scrubEnvironment, type ScrubOptions } from './scrub.js';
export { isSecret, REDACTED, Secret } from './secret.js';
export { createSecretStore, type SecretStore, type SecretStoreOptions } from './store.js';
export { isUntrustedContext, SecretAccessDeniedError, UNTRUSTED_ENV_VAR } from './trust.js';
