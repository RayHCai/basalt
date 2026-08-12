import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import { decrypt, encrypt } from './crypto.js';
import type { SealedBox } from './crypto.js';
import { resolveMasterKey } from './key.js';
import { assertValidName } from './names.js';
import { storeFile } from './paths.js';
import type { Env } from './paths.js';
import { REDACTED, Secret } from './secret.js';
import { assertTrustedContext } from './trust.js';

/** On-disk store format version. */
const STORE_VERSION = 1;

/** Owner-only permissions for the store file. */
const STORE_FILE_MODE = 0o600;

/** The persisted store document: a version tag plus name → sealed box map. */
interface StoreDocument {
  v: number;
  secrets: Record<string, SealedBox>;
}

/** Options for {@link createSecretStore}. */
interface SecretStoreOptions {
  /**
   * Secrets directory. REQUIRED — `@basalt/config` owns where state lives and
   * passes an absolute path in; secrets never resolves the location itself.
   */
  dir: string;
  /** Environment map (for trust checks + key resolution). Defaults to `process.env`. */
  env?: Env;
}

/**
 * The public-facing secret store, and the surface `@basalt/config` routes
 * sensitive values through. Following the config package's two-phase model,
 * {@link createSecretStore} loads and decrypts lazily-on-demand from an
 * in-memory sealed-box cache, so reads are synchronous and mutations
 * (which persist to disk) are async.
 *
 * Every accessor re-checks the trust gate, so a handle that leaks into
 * untrusted code (the agent harness) is inert there. Values are returned as
 * {@link Secret} boxes — never bare strings — so reading one requires a
 * deliberate `.expose()`.
 */
interface SecretStore {
  /** Store (or overwrite) a secret. Accepts a raw string or a {@link Secret}. */
  set: (name: string, value: string | Secret) => Promise<void>;
  /** Delete a secret; `true` if one was removed, `false` if it was absent. */
  delete: (name: string) => Promise<boolean>;
  /** Fetch a secret, or `undefined` if absent. */
  get: (name: string) => Secret | undefined;
  /** Fetch a secret, throwing if absent. */
  require: (name: string) => Secret;
  /** `true` if a secret with this name exists. */
  has: (name: string) => boolean;
  /** All secret names (non-sensitive labels), unsorted. */
  list: () => string[];
  /** A `name → "[redacted]"` map safe to log or surface for diagnostics. */
  redacted: () => Record<string, string>;
  /**
   * Re-point this store at a different environment map (primarily for tests
   * that simulate a handle crossing into an untrusted context). Returns `this`.
   */
  withEnv: (env: Env) => SecretStore;
}

function emptyDocument(): StoreDocument {
  return { v: STORE_VERSION, secrets: {} };
}

/** Load and validate the store document, tolerating a missing file. */
async function readDocument(path: string): Promise<StoreDocument> {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyDocument();
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as StoreDocument).v !== STORE_VERSION ||
    typeof (parsed as StoreDocument).secrets !== 'object'
  ) {
    throw new Error(`Malformed secret store at ${path}`);
  }
  return parsed as StoreDocument;
}

/**
 * Persist the document atomically with `0600` perms: same-dir unique temp →
 * chmod → rename. Never leaves a partial or briefly world-readable file.
 */
async function writeDocument(dir: string, path: string, doc: StoreDocument): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid.toString()}.tmp`;
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  await writeFile(tmp, body, { mode: STORE_FILE_MODE });
  await chmod(tmp, STORE_FILE_MODE);
  await rename(tmp, path);
}

/**
 * Open (or create) the secret store rooted at `dir`. Resolves the master key
 * eagerly — which also enforces the trust gate up front — and loads the
 * existing sealed boxes into memory. Refused in an untrusted context.
 */
async function createSecretStore(options: SecretStoreOptions): Promise<SecretStore> {
  let env: Env = options.env ?? process.env;
  const { dir } = options;
  const path = storeFile(dir);

  assertTrustedContext('read', env);
  const key = await resolveMasterKey(dir, env);
  const doc = await readDocument(path);

  const store: SecretStore = {
    async set(name: string, value: string | Secret): Promise<void> {
      assertTrustedContext('write', env);
      assertValidName(name);
      const secret = value instanceof Secret ? value : new Secret(value);
      if (secret.length === 0) {
        throw new RangeError(`Refusing to store an empty secret for "${name}"`);
      }
      doc.secrets[name] = encrypt(key, name, secret);
      await writeDocument(dir, path, doc);
    },

    async delete(name: string): Promise<boolean> {
      assertTrustedContext('write', env);
      assertValidName(name);
      if (!Object.hasOwn(doc.secrets, name)) {
        return false;
      }
      delete doc.secrets[name];
      await writeDocument(dir, path, doc);
      return true;
    },

    get(name: string): Secret | undefined {
      assertTrustedContext('decrypt', env);
      assertValidName(name);
      const box = doc.secrets[name];
      if (box === undefined) {
        return undefined;
      }
      return decrypt(key, name, box);
    },

    require(name: string): Secret {
      const secret = store.get(name);
      if (secret === undefined) {
        throw new Error(`Required secret "${name}" is not set`);
      }
      return secret;
    },

    has(name: string): boolean {
      assertTrustedContext('read', env);
      assertValidName(name);
      return Object.hasOwn(doc.secrets, name);
    },

    list(): string[] {
      assertTrustedContext('read', env);
      return Object.keys(doc.secrets);
    },

    redacted(): Record<string, string> {
      assertTrustedContext('read', env);
      const view: Record<string, string> = {};
      for (const name of Object.keys(doc.secrets)) {
        view[name] = REDACTED;
      }
      return view;
    },

    withEnv(next: Env): SecretStore {
      env = next;
      return store;
    },
  };

  return store;
}

export { createSecretStore, type SecretStore, type SecretStoreOptions };
