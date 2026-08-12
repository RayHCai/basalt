import { assertValidName } from '@basalt/secrets';
import type { Secret, SecretStore } from '@basalt/secrets';

import type { Env } from './paths.js';
import { openSecretStore } from './secret-store.js';
import { secretStoreName } from './secrets-bridge.js';

/**
 * High-level "set one secret" entry point behind `basalt secret set <name>`.
 *
 * The subtlety this function exists to encapsulate: config never stores a secret
 * under the literal name a user types. A config field holds a marker
 * `{ "$secret": "<ref>" }`, and the store resolves it by looking up
 * `secretStoreName(<ref>)` — a hashed, allowlist-safe `cfg-<digest>` key (see
 * {@link secretStoreName} and `secrets-bridge.ts`). So to make
 * `basalt secret set anthropic-api-key <value>` actually satisfy a marker
 * `{ "$secret": "anthropic-api-key" }`, the value must be sealed under
 * `secretStoreName("anthropic-api-key")`, NOT under the bare name. Sealing it
 * flat via `@basalt/secrets` directly would leave the marker dangling and the
 * provider would read `undefined`.
 *
 * `name` is therefore the REF a config marker points at (the exact string inside
 * `{ "$secret": ... }`). It is validated with the same allowlist the store uses
 * so a bad name fails here with a clear error rather than deep in the store.
 */

/** Options for {@link setSecret}. Mirrors {@link CreateConfigSectionOptions}'s seams. */
interface SetSecretOptions {
  /** Environment map (state-dir resolution). Defaults to `process.env`. */
  env?: Env;
  /** Secret store to route through. If omitted, one is opened at `<STATE_DIR>/secrets`. */
  secrets?: SecretStore;
}

/**
 * Seal `value` for the config secret `name`, encrypted at rest under
 * `<STATE_DIR>/secrets`. `name` is the ref a `{ "$secret": name }` marker uses;
 * the value is stored under the derived {@link secretStoreName} so config
 * resolves the marker to it. Overwrites any existing value for that name.
 *
 * The store rejects an empty value (a zero-length secret is refused), so a
 * caller that reads an empty stdin/prompt surfaces that as an error rather than
 * silently storing nothing.
 */
async function setSecret(
  name: string,
  value: string | Secret,
  options: SetSecretOptions = {},
): Promise<void> {
  // Validate the caller-facing ref up front so a bad name is a clear error, not
  // an opaque one from the derived store key (which is always allowlist-valid).
  assertValidName(name);
  const env = options.env ?? process.env;
  const secrets = options.secrets ?? (await openSecretStore(env));
  await secrets.set(secretStoreName(name), value);
}

export { setSecret, type SetSecretOptions };
