import type { SecretStore } from '@basalt/secrets';

import { initConfig } from './init.js';
import type { Env } from './paths.js';
import { resetSecretStores } from './secret-store.js';
import type { ConfigStore } from './store.js';

/**
 * The SHARED config store other packages consume without doing any wiring.
 *
 * Config init (opening the secret store, seeding `main.json`, validating every
 * section) happens ONCE here, at the composition root, via {@link configureConfig}.
 * Downstream packages then call {@link getConfig} — a synchronous accessor that
 * returns the already-loaded store, mirroring how `@basalt/observability` exposes
 * a shared root logger via `configureRootLogger` / `getLogger`.
 *
 * The contract is explicit on purpose: `getConfig()` THROWS before
 * `configureConfig()` has run, rather than lazily initializing, so startup
 * ordering is visible and the accessor keeps the store's synchronous getters.
 */

// The memoized shared store. Undefined until configureConfig() runs.
// oxlint-disable-next-line init-declarations
let shared: ConfigStore | undefined;

/** Options for {@link configureConfig}. Same wiring seams as {@link initConfig}. */
interface ConfigureConfigOptions {
  /** Environment map (state-dir resolution + main env overlay). Defaults to `process.env`. */
  env?: Env;
  /**
   * Secret store to route sensitive values through. If omitted, one is opened at
   * `<STATE_DIR>/secrets`. Injectable so a trusted broker can own a single
   * shared store and pass the same instance in.
   */
  secrets?: SecretStore;
}

/**
 * Open, seed, load, and memoize the shared config store. Call once at startup,
 * once the state directory is known. Idempotent-friendly: calling it again
 * re-runs init/load and swaps the shared store (the underlying `init()` only
 * writes `main.json` when absent, so re-running never destroys config).
 */
async function configureConfig(options: ConfigureConfigOptions = {}): Promise<ConfigStore> {
  const { store } = await initConfig(options);
  shared = store;
  return shared;
}

/**
 * The shared, loaded config store. Synchronous — its getters are too. Throws if
 * {@link configureConfig} has not run, since reading config before it is loaded
 * is a startup-ordering bug, not a recoverable condition.
 */
function getConfig(): ConfigStore {
  if (shared === undefined) {
    throw new Error(
      'Config store not configured; call await configureConfig() at startup before getConfig().',
    );
  }
  return shared;
}

/** Drop the memoized shared store. Primarily for tests and re-initialization. */
function resetConfig(): void {
  shared = undefined;
  resetSecretStores();
}

export { configureConfig, type ConfigureConfigOptions, getConfig, resetConfig };
