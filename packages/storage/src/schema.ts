import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema definition + migration ladder. The database version is tracked in
 * SQLite's built-in `PRAGMA user_version` (an integer stored in the file
 * header). {@link migrate} applies every migration whose index is beyond the
 * current version, inside a transaction, and bumps the version to match. This is
 * the seam the readme's other object types (cron registry, config/plugin
 * tracking) grow into: append a migration to {@link MIGRATIONS}, never edit an
 * existing one.
 */

/**
 * The ordered migration ladder. Index `i` is migration number `i + 1`; a fresh
 * database runs them all, an existing one runs only those past its
 * `user_version`. Each entry is the SQL for one version step and MUST be
 * append-only once shipped — editing a shipped migration would diverge new
 * databases from migrated ones.
 */
const MIGRATIONS: readonly string[] = [
  // v1 — sessions. A session is an id plus creation/update timestamps. STRICT so
  // a wrong-typed write is rejected at the engine rather than silently coerced;
  // `created_at`/`updated_at` are ISO-8601 strings (see time.ts).
  `CREATE TABLE sessions (
     id         TEXT PRIMARY KEY NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT;`,

  // v2 — primary-session role. A session may be designated the singleton
  // 'primary' service owner, carrying the owning `basalt start` pid. The partial
  // unique index enforces at-most-one primary.
  `ALTER TABLE sessions ADD COLUMN role TEXT;
   ALTER TABLE sessions ADD COLUMN pid INTEGER;
   CREATE UNIQUE INDEX ux_sessions_primary
     ON sessions (role) WHERE role = 'primary';`,
];

/** The schema version this build expects — the length of the ladder. */
const SCHEMA_VERSION: number = MIGRATIONS.length;

/** Read the database's current schema version from `PRAGMA user_version`. */
function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.['user_version'] ?? 0);
}

/**
 * Bring `db` up to {@link SCHEMA_VERSION}, applying each pending migration in a
 * single transaction so a failure leaves the version and tables untouched.
 * Idempotent: an already-current database does no work. Called once by
 * {@link createStorageStore} on open.
 */
function migrate(db: DatabaseSync): void {
  const from = currentVersion(db);
  if (from >= SCHEMA_VERSION) {
    return;
  }
  db.exec('BEGIN');
  try {
    for (let version = from; version < SCHEMA_VERSION; version++) {
      // `version` is the array index of the migration that lifts the DB to
      // `version + 1`; MIGRATIONS.length === SCHEMA_VERSION bounds this access.
      db.exec(MIGRATIONS[version] ?? '');
    }
    // user_version takes an integer literal, not a bound parameter.
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION.toString()}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export { currentVersion, migrate, MIGRATIONS, SCHEMA_VERSION };
