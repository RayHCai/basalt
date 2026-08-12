import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { currentVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from './schema.js';

/** Names of the user tables present in `db` (excluding SQLite's internal ones). */
function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name).toSorted();
}

describe('migrate', () => {
  it('brings a fresh database to the current schema version', () => {
    const db = openDatabase(':memory:');
    expect(currentVersion(db)).toBe(0);
    migrate(db);
    expect(currentVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('creates the sessions table', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(tableNames(db)).toContain('sessions');
    db.close();
  });

  it('is idempotent — a second run is a no-op', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const before = tableNames(db);
    migrate(db);
    expect(currentVersion(db)).toBe(SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(before);
    db.close();
  });

  it('has a version equal to the ladder length', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('enforces NOT NULL on the sessions columns', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const insert = db.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)');
    // The primary key and both timestamps are declared NOT NULL.
    expect(() => insert.run(null, 'x', 'y')).toThrow();
    expect(() => insert.run('a', null, 'y')).toThrow();
    expect(() => insert.run('a', 'x', null)).toThrow();
    db.close();
  });
});
