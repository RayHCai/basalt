import { createSecretStore } from '@basalt/secrets';
import type { SecretStore } from '@basalt/secrets';

import { secretsDir } from './paths.js';
import type { Env } from './paths.js';

/**
 * Config-owned access to the secret store. `@basalt/secrets` no longer resolves
 * WHERE it lives — this module owns that decision ({@link secretsDir}, derived
 * from the config-owned STATE_DIR) and passes the absolute `dir` in.
 *
 * It also memoizes a SINGLE store instance per resolved secrets directory, so
 * every entry point in this package ({@link initConfig}, {@link createConfigSection},
 * the shared {@link configureConfig} singleton) shares one store rather than
 * opening — and re-resolving the master key for — its own. Keyed by directory so
 * tests pointing at different temp STATE_DIRs stay isolated; in production there
 * is one STATE_DIR and therefore one store.
 */

// Resolved secrets dir → in-flight/opened store. A rejected open is evicted (see
// below) so a transient failure (e.g. an untrusted context) is never cached.
const stores = new Map<string, Promise<SecretStore>>();

/**
 * Open (or return the memoized) secret store for `env`'s STATE_DIR. Callers that
 * already hold a store (a trusted broker) should pass it directly and skip this.
 *
 * The in-flight promise is cached synchronously (before the first await) so
 * concurrent callers dedupe onto one open; a rejected open is evicted so a
 * transient failure (e.g. an untrusted context) is never cached.
 */
function openSecretStore(env: Env = process.env): Promise<SecretStore> {
  const dir = secretsDir(env);
  const existing = stores.get(dir);
  if (existing !== undefined) {
    return existing;
  }
  const opening = openAndEvictOnFailure(dir, env);
  stores.set(dir, opening);
  return opening;
}

/** Open the store, dropping the cache entry if the open rejects. */
async function openAndEvictOnFailure(dir: string, env: Env): Promise<SecretStore> {
  try {
    return await createSecretStore({ dir, env });
  } catch (error) {
    stores.delete(dir);
    throw error;
  }
}

/** Drop all memoized secret stores. Primarily for tests and re-initialization. */
function resetSecretStores(): void {
  stores.clear();
}

export { openSecretStore, resetSecretStores };
