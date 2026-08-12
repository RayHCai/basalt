import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';

import { DuplicateSessionError, PrimaryAlreadyClaimedError } from './errors.js';
import { assertValidId, newId } from './ids.js';
import { isProcessAlive } from './process.js';
import type { Clock } from './time.js';

/**
 * A persisted session: a stable id plus creation/update timestamps. Timestamps
 * are ISO-8601 strings (`2026-07-14T12:00:00.000Z`), matching the CLI's
 * `SessionInfo.startedAt`, so a reader can compare/sort them lexicographically.
 */
interface Session {
  /** Stable session identifier — a v4 UUID by default (see {@link newId}). */
  readonly id: string;
  /** ISO-8601 timestamp of when the session row was created. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of the session's last update (equal to `createdAt` when fresh). */
  readonly updatedAt: string;
  /** Session role: `'primary'` for the singleton service owner, `null` otherwise. */
  readonly role: 'primary' | null;
  /** The owning `basalt start` process pid (set only when `role='primary'`). */
  readonly pid: number | null;
}

/** Input for {@link SessionRepository.create}. `id` is optional — omit to mint a UUID. */
interface CreateSessionInput {
  /**
   * Use this id instead of a freshly minted UUID. Must pass {@link assertValidId}.
   * Throws {@link DuplicateSessionError} if a session with this id already exists.
   */
  id?: string;
  /** Session role: `'primary'` for the singleton service owner. */
  role?: 'primary' | null;
  /** The owning `basalt start` process pid (meaningful only with `role='primary'`). */
  pid?: number | null;
}

/**
 * CRUD over the `sessions` table. Every method is SYNCHRONOUS — `node:sqlite` is
 * a synchronous engine, so wrapping it in promises would only add ceremony;
 * a caller that needs the CLI's async `StorageReader` shape wraps these trivially
 * (`Promise.resolve(store.sessions.all())`).
 *
 * Statements are prepared once at construction and reused per call.
 */
interface SessionRepository {
  /**
   * Insert a new session and return it. Without an `id`, mints a UUID; with one,
   * validates it and throws {@link DuplicateSessionError} on collision.
   * `createdAt` and `updatedAt` are set to the same current timestamp.
   */
  create: (input?: CreateSessionInput) => Session;
  /** Fetch a session by id, or `undefined` if none exists. Validates the id. */
  get: (id: string) => Session | undefined;
  /** Fetch every session, newest-created first. */
  all: () => Session[];
  /** `true` if a session with this id exists. Validates the id. */
  has: (id: string) => boolean;
  /** Total number of sessions. */
  count: () => number;
  /**
   * Stamp a session's `updatedAt` to now and return the updated row, or
   * `undefined` if no such session exists. Validates the id.
   */
  touch: (id: string) => Session | undefined;
  /**
   * Delete a session by id. Returns `true` if a row was removed, `false` if the
   * id was absent. Validates the id.
   */
  delete: (id: string) => boolean;
  /**
   * Claim the singleton primary session for the given pid. Inserts a new row with
   * `role='primary'`. If a live primary already exists, throws
   * {@link PrimaryAlreadyClaimedError}. If the existing primary is stale (dead
   * pid), reclaims it by deleting the stale row before inserting.
   */
  claimPrimary: (pid: number) => Session;
  /** Fetch the primary session row, or `undefined` if none exists. */
  getPrimary: () => Session | undefined;
  /**
   * Delete the primary session row by id. Returns `true` if a row was removed.
   * This is the kill switch: deleting the row signals the agent loop to abort.
   */
  releasePrimary: (id: string) => boolean;
}

/** SQLITE UNIQUE/primary-key violation — the code `node:sqlite` sets on the thrown Error. */
const SQLITE_ERROR_CODE = 'ERR_SQLITE_ERROR';
const UNIQUE_CONSTRAINT_ERRCODE = 1555;

/**
 * `true` if `session` is a live primary — it has `role='primary'`, a non-null
 * pid, and that pid refers to a running process. Lives here rather than in
 * `./process.js` so the process module stays a session-agnostic leaf.
 */
function isPrimaryLive(session: Session): boolean {
  return session.role === 'primary' && session.pid !== null && isProcessAlive(session.pid);
}

/**
 * Normalize a raw `pid` column value to `number | null`. The column is
 * `INTEGER`, so the engine hands back a number, but a `NULL` (non-primary row)
 * or a value round-tripped as text is coerced here rather than at the call site.
 */
function toPid(value: SQLOutputValue | undefined): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

/**
 * Map a raw SQLite row (dynamic `Record<string, SQLOutputValue>`) to a
 * {@link Session}. The `sessions` columns are `TEXT NOT NULL`, and every write
 * goes through this repository, so the values are strings; `String(...)`
 * normalizes the engine's output type without changing them.
 */
function rowToSession(row: Record<string, SQLOutputValue>): Session {
  const { role, pid } = row;
  return {
    id: String(row['id']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
    role: role === 'primary' ? 'primary' : null,
    pid: toPid(pid),
  };
}

/** `true` if `error` is `node:sqlite`'s UNIQUE/primary-key constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as { code?: unknown; errcode?: unknown };
  return e.code === SQLITE_ERROR_CODE && e.errcode === UNIQUE_CONSTRAINT_ERRCODE;
}

/**
 * Build the sessions repository over an open database. Called by
 * {@link createStorageStore}; the schema is already migrated by then, so the
 * prepared statements below reference existing columns.
 */
function createSessionRepository(db: DatabaseSync, clock: Clock): SessionRepository {
  const insertStmt: StatementSync = db.prepare(
    'INSERT INTO sessions (id, created_at, updated_at, role, pid) VALUES (:id, :createdAt, :updatedAt, :role, :pid)',
  );
  const getStmt: StatementSync = db.prepare(
    'SELECT id, created_at, updated_at, role, pid FROM sessions WHERE id = :id',
  );
  const allStmt: StatementSync = db.prepare(
    'SELECT id, created_at, updated_at, role, pid FROM sessions ORDER BY created_at DESC, id ASC',
  );
  const countStmt: StatementSync = db.prepare('SELECT COUNT(*) AS n FROM sessions');
  const touchStmt: StatementSync = db.prepare(
    'UPDATE sessions SET updated_at = :updatedAt WHERE id = :id',
  );
  const deleteStmt: StatementSync = db.prepare('DELETE FROM sessions WHERE id = :id');
  const getPrimaryStmt: StatementSync = db.prepare(
    "SELECT id, created_at, updated_at, role, pid FROM sessions WHERE role = 'primary'",
  );
  const deletePrimaryStmt: StatementSync = db.prepare(
    "DELETE FROM sessions WHERE id = :id AND role = 'primary'",
  );

  const repo: SessionRepository = {
    create(input: CreateSessionInput = {}): Session {
      const id = input.id === undefined ? newId() : assertValidId(input.id);
      const now = clock();
      const role = input.role ?? null;
      const pid = input.pid ?? null;
      try {
        insertStmt.run({ id, createdAt: now, updatedAt: now, role, pid });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateSessionError(id);
        }
        throw error;
      }
      return { id, createdAt: now, updatedAt: now, role, pid };
    },

    get(id: string): Session | undefined {
      assertValidId(id);
      const row = getStmt.get({ id });
      return row === undefined ? undefined : rowToSession(row);
    },

    all(): Session[] {
      return allStmt.all().map((row) => rowToSession(row));
    },

    has(id: string): boolean {
      assertValidId(id);
      return getStmt.get({ id }) !== undefined;
    },

    count(): number {
      const row = countStmt.get();
      return Number(row?.['n'] ?? 0);
    },

    touch(id: string): Session | undefined {
      assertValidId(id);
      const now = clock();
      const result = touchStmt.run({ id, updatedAt: now });
      // `changes` is `number | bigint`; normalize before comparing (0n === 0 is false).
      if (Number(result.changes) === 0) {
        return undefined;
      }
      return repo.get(id);
    },

    delete(id: string): boolean {
      assertValidId(id);
      const result = deleteStmt.run({ id });
      return Number(result.changes) > 0;
    },

    claimPrimary(pid: number): Session {
      const existing = repo.getPrimary();
      if (existing) {
        if (existing.pid !== null && isProcessAlive(existing.pid)) {
          throw new PrimaryAlreadyClaimedError(existing.id, existing.pid);
        }
        // Stale row (dead pid) — reclaim by deleting before inserting.
        deleteStmt.run({ id: existing.id });
      }
      return repo.create({ role: 'primary', pid });
    },

    getPrimary(): Session | undefined {
      const row = getPrimaryStmt.get();
      return row === undefined ? undefined : rowToSession(row);
    },

    releasePrimary(id: string): boolean {
      assertValidId(id);
      const result = deletePrimaryStmt.run({ id });
      return Number(result.changes) > 0;
    },
  };

  return repo;
}

export {
  type CreateSessionInput,
  createSessionRepository,
  isPrimaryLive,
  type Session,
  type SessionRepository,
};
