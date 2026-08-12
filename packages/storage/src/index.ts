/**
 * `@basalt/storage` — light-weight SQLite storage for the Basalt runtime.
 *
 * This is the persistence layer for the runtime's stateful objects: today
 * sessions, and (per the root README) the cron registry and config/plugin
 * tracking as they land. It is built on Node 24's built-in `node:sqlite`
 * (zero external dependencies) and is a LEAF package — it depends on nothing
 * internal, so `@basalt/config` can be "built on storage" without a cycle.
 *
 * Like `@basalt/secrets`, storage does NOT decide where state lives: the caller
 * (`@basalt/config`) owns STATE_DIR resolution and passes an absolute `dir` in.
 * The database file is `<dir>/basalt.db`.
 *
 * The store exposes one repository per object type. Each gives the full CRUD the
 * runtime and CLI need — create, fetch-by-id, fetch-all, existence, delete (plus
 * a `touch` to bump `updatedAt`). Every repository call is synchronous
 * (`node:sqlite` is a synchronous engine); only {@link createStorageStore} is
 * async, for the one-time directory setup. A caller needing the CLI's async
 * `StorageReader` shape wraps a call in `Promise.resolve(...)`.
 *
 * ```ts
 * import { createStorageStore } from '@basalt/storage';
 * import { storageDir } from '@basalt/config'; // config owns the location
 *
 * const store = await createStorageStore({ dir: storageDir() });
 * const session = store.sessions.create();       // { id: <uuid>, createdAt, updatedAt }
 * store.sessions.get(session.id);                 // fetch by id
 * store.sessions.all();                           // fetch all, newest first
 * store.sessions.touch(session.id);               // bump updatedAt
 * store.sessions.delete(session.id);              // → true
 * store.close();
 * ```
 */

// Store + factory — the primary surface.
export {
  createStorageStore,
  MEMORY_DB,
  type StorageStore,
  type StorageStoreOptions,
} from './store.js';

// Session object + its repository (create / get / all / has / count / touch / delete),
// plus the primary-liveness predicate over a session row.
export {
  type CreateSessionInput,
  isPrimaryLive,
  type Session,
  type SessionRepository,
} from './sessions.js';

// Error taxonomy — distinguish an expected conflict from an unexpected fault.
export { DuplicateSessionError, PrimaryAlreadyClaimedError, StorageError } from './errors.js';

// Process-liveness primitive for primary-session management.
export { isProcessAlive } from './process.js';

// Id helpers (v4 UUID minting + validation) and the database path helper.
export { assertValidId, isValidId, MAX_ID_LENGTH, newId } from './ids.js';
export { DB_FILE_NAME, dbFile } from './paths.js';

// Schema version + migration ladder (exposed for diagnostics / tests).
export { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

// Clock seam for deterministic timestamps under test.
export { type Clock, systemClock } from './time.js';
