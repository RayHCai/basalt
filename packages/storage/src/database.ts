import { DatabaseSync } from 'node:sqlite';

/**
 * Connection setup shared by every store. `node:sqlite` (Node 24's built-in,
 * zero-dependency SQLite) is opened synchronously; the pragmas below are applied
 * once on open.
 */

/** Busy-timeout (ms): how long a write waits for a competing writer before erroring. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Open a SQLite database at `path` and apply the pragmas every store shares:
 *   - **WAL** journaling — concurrent readers alongside a single writer, and
 *     fewer fsyncs than the rollback journal. (A no-op for `:memory:`.)
 *   - **foreign_keys ON** — SQLite leaves FK enforcement off per-connection by
 *     default; turn it on so future cross-object references are enforced.
 *   - **busy_timeout** — a momentary writer contention retries for
 *     {@link BUSY_TIMEOUT_MS} instead of immediately throwing `SQLITE_BUSY`.
 *
 * `path` may be `:memory:` for an ephemeral database (used by tests).
 */
function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS.toString()}`);
  return db;
}

export { openDatabase };
