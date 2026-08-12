import { mkdir } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from './database.js';
import { dbFile } from './paths.js';
import { migrate } from './schema.js';
import { createSessionRepository } from './sessions.js';
import type { SessionRepository } from './sessions.js';
import { systemClock } from './time.js';
import type { Clock } from './time.js';

/** Owner-only permissions for the storage directory, matching the rest of managed state. */
const STORAGE_DIR_MODE = 0o700;

/** In-memory database sentinel — an ephemeral DB with no file on disk (used by tests). */
const MEMORY_DB = ':memory:';

/** Options for {@link createStorageStore}. */
interface StorageStoreOptions {
  /**
   * Storage directory. REQUIRED — `@basalt/config` owns where state lives and
   * passes an absolute path in; storage never resolves the location itself. Pass
   * `':memory:'` for an ephemeral, file-less database.
   */
  dir: string;
  /**
   * Clock for `createdAt`/`updatedAt` stamping. Defaults to the system wall-clock
   * ({@link systemClock}); injectable so tests get deterministic timestamps.
   */
  clock?: Clock;
}

/**
 * The storage store: a light-weight SQLite-backed home for the runtime's
 * persistent objects. Today it holds one object type — {@link sessions} — with
 * creation, retrieval (by id + fetch-all), existence, and deletion. The readme's
 * further object types (cron registry, config/plugin tracking) land as sibling
 * repositories on this same store, each behind its own migration.
 *
 * Every repository method is synchronous (see {@link SessionRepository}); only
 * {@link createStorageStore} is async, for the one-time directory setup.
 */
interface StorageStore {
  /** CRUD over sessions. */
  readonly sessions: SessionRepository;
  /** Close the underlying database. Idempotent-safe to call once at shutdown. */
  close: () => void;
}

/**
 * Open (or create) the storage store rooted at `dir`. Creates the directory
 * (`0700`, recursive) if needed, opens the SQLite database with the shared
 * pragmas, runs any pending migrations, and wires the repositories.
 *
 * Async only for the `mkdir`; the returned store is synchronous. Pass
 * `dir: ':memory:'` for an ephemeral database with no filesystem side effects.
 */
async function createStorageStore(options: StorageStoreOptions): Promise<StorageStore> {
  const { dir } = options;
  const clock = options.clock ?? systemClock;

  const path = dir === MEMORY_DB ? MEMORY_DB : dbFile(dir);
  if (dir !== MEMORY_DB) {
    await mkdir(dir, { recursive: true, mode: STORAGE_DIR_MODE });
  }

  const db: DatabaseSync = openDatabase(path);
  migrate(db);

  const sessions = createSessionRepository(db, clock);

  return {
    sessions,
    close(): void {
      db.close();
    },
  };
}

export { createStorageStore, MEMORY_DB, type StorageStore, type StorageStoreOptions };
