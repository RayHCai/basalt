import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import { KEY_BYTES } from './crypto.js';
import { keyFile } from './paths.js';
import type { Env } from './paths.js';
import { assertTrustedContext } from './trust.js';

/**
 * Environment variable holding the master key directly (base64 or hex). Takes
 * precedence over the on-disk keyfile — the deployment path for CI/servers that
 * inject the key from a real secret manager and never want it on disk.
 */
const KEY_ENV_VAR = 'BASALT_SECRETS_KEY';

/** Owner-only permissions for the generated keyfile. */
const KEY_FILE_MODE = 0o600;

/**
 * Decode a master key supplied as an environment string. Accepts base64 or hex
 * and validates the decoded length. A wrong-sized value is a hard error rather
 * than a silent truncation.
 */
function decodeEnvKey(raw: string): Buffer {
  const trimmed = raw.trim();
  // Try hex first only when it looks like hex of the exact length; otherwise
  // base64. Both are validated against KEY_BYTES below.
  const isHex = /^[0-9a-f]+$/iu.test(trimmed) && trimmed.length === KEY_BYTES * 2;
  const key = isHex ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new RangeError(
      `${KEY_ENV_VAR} must decode to ${KEY_BYTES} bytes (got ${key.length}); ` +
        `provide a base64 or hex encoded 256-bit key.`,
    );
  }
  return key;
}

/** Read an existing keyfile, returning `undefined` if it does not exist. */
async function readKeyFile(path: string): Promise<Buffer | undefined> {
  try {
    const key = await readFile(path);
    if (key.length !== KEY_BYTES) {
      throw new RangeError(
        `Key file ${path} is ${key.length} bytes; expected ${KEY_BYTES}. ` +
          `Refusing to use a malformed master key.`,
      );
    }
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Generate a fresh 256-bit key and persist it atomically with `0600`
 * permissions (same-dir temp → chmod → rename), so it is never briefly world
 * readable and a crash cannot leave a partial file.
 */
async function generateKeyFile(dir: string, path: string): Promise<Buffer> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  const tmp = `${path}.${process.pid.toString()}.tmp`;
  await writeFile(tmp, key, { mode: KEY_FILE_MODE });
  await chmod(tmp, KEY_FILE_MODE);
  await rename(tmp, path);
  return key;
}

/**
 * Resolve the master key used to seal/open the store, in precedence order:
 *
 *   1. `BASALT_SECRETS_KEY` env var (base64 or hex 256-bit) — never touches disk
 *   2. existing `<dir>/key` file
 *   3. a freshly generated key, persisted to that path with `0600`
 *
 * Refused outright in an untrusted context (the agent harness): the key is the
 * root of trust and must never be materialized there.
 *
 * @param dir the secrets directory. REQUIRED — `@basalt/config` owns where this
 *   lives and passes it in; secrets never resolves the location itself.
 */
async function resolveMasterKey(dir: string, env: Env = process.env): Promise<Buffer> {
  assertTrustedContext('resolveKey', env);

  const fromEnv = env[KEY_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return decodeEnvKey(fromEnv);
  }

  const path = keyFile(dir);
  const existing = await readKeyFile(path);
  if (existing !== undefined) {
    return existing;
  }
  return generateKeyFile(dir, path);
}

export { KEY_ENV_VAR, resolveMasterKey };
