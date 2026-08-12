import { join } from 'node:path';

/**
 * File-name helpers for the secret store. This package deliberately does NOT
 * resolve WHERE the store lives — STATE_DIR resolution and the secrets-directory
 * default are owned by `@basalt/config`, which passes an absolute `dir` into
 * {@link createSecretStore} / {@link resolveMasterKey}. Keeping the location out
 * of secrets removes the duplicated default that used to drift from config's,
 * and preserves the dependency direction (config → secrets, never the reverse).
 *
 * What stays here are the fixed file names inside that directory and the joins
 * that build absolute paths from a caller-supplied `dir`.
 */

/** File (under the secrets dir) holding the encrypted name → box map. */
const STORE_FILE_NAME = 'secrets.json';

/** File (under the secrets dir) holding the raw 32-byte master key. */
const KEY_FILE_NAME = 'key';

type Env = Readonly<Record<string, string | undefined>>;

/** Absolute path to the encrypted store file, `<dir>/secrets.json`. */
function storeFile(dir: string): string {
  return join(dir, STORE_FILE_NAME);
}

/** Absolute path to the master key file, `<dir>/key`. */
function keyFile(dir: string): string {
  return join(dir, KEY_FILE_NAME);
}

export { type Env, KEY_FILE_NAME, keyFile, STORE_FILE_NAME, storeFile };
