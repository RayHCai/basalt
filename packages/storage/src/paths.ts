import { join } from 'node:path';

/**
 * File-name helper for the storage database. Like `@basalt/secrets`, this
 * package deliberately does NOT resolve WHERE state lives — STATE_DIR resolution
 * is owned by `@basalt/config`, which passes an absolute `dir` into
 * {@link createStorageStore}. Keeping the location out of storage preserves the
 * dependency direction (config → storage, never the reverse) and avoids a second
 * copy of the default that could drift from config's.
 */

/** File (under the storage dir) holding the SQLite database. */
const DB_FILE_NAME = 'basalt.db';

/** Absolute path to the SQLite database file, `<dir>/basalt.db`. */
function dbFile(dir: string): string {
  return join(dir, DB_FILE_NAME);
}

export { DB_FILE_NAME, dbFile };
