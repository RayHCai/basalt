import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { DuplicateSessionError } from './errors.js';
import { migrate } from './schema.js';
import { createSessionRepository } from './sessions.js';
import type { SessionRepository } from './sessions.js';
import type { Clock } from './time.js';

/**
 * A controllable clock: returns the value of `now`, which a test can advance
 * between calls to make `createdAt`/`updatedAt` deterministic and distinct.
 */
function fakeClock(): { clock: Clock; set: (value: string) => void } {
  let now = '2026-07-14T00:00:00.000Z';
  return {
    clock: () => now,
    set: (value: string) => {
      now = value;
    },
  };
}

// oxlint-disable-next-line init-declarations
let sessions: SessionRepository;
// oxlint-disable-next-line init-declarations
let clock: ReturnType<typeof fakeClock>;

beforeEach(() => {
  const db = openDatabase(':memory:');
  migrate(db);
  clock = fakeClock();
  sessions = createSessionRepository(db, clock.clock);
});

describe('sessions.create', () => {
  it('mints a UUID id when none is supplied', () => {
    const session = sessions.create();
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('sets createdAt and updatedAt to the current time, equal when fresh', () => {
    clock.set('2026-07-14T12:00:00.000Z');
    const session = sessions.create();
    expect(session.createdAt).toBe('2026-07-14T12:00:00.000Z');
    expect(session.updatedAt).toBe('2026-07-14T12:00:00.000Z');
  });

  it('persists the created session so it can be fetched back', () => {
    const created = sessions.create();
    expect(sessions.get(created.id)).toEqual(created);
  });

  it('accepts a caller-supplied id', () => {
    const session = sessions.create({ id: 'default-session' });
    expect(session.id).toBe('default-session');
    expect(sessions.has('default-session')).toBe(true);
  });

  it('rejects an invalid caller-supplied id', () => {
    expect(() => sessions.create({ id: '../escape' })).toThrow();
  });

  it('throws DuplicateSessionError on a colliding id', () => {
    sessions.create({ id: 'dup' });
    expect(() => sessions.create({ id: 'dup' })).toThrow(DuplicateSessionError);
    try {
      sessions.create({ id: 'dup' });
    } catch (error) {
      expect((error as DuplicateSessionError).id).toBe('dup');
    }
  });
});

describe('sessions.get', () => {
  it('returns undefined for a missing session', () => {
    expect(sessions.get('nope')).toBeUndefined();
  });

  it('fetches a session by id', () => {
    const created = sessions.create({ id: 'abc' });
    expect(sessions.get('abc')).toEqual(created);
  });

  it('validates the id', () => {
    expect(() => sessions.get('a/b')).toThrow();
  });
});

describe('sessions.all', () => {
  it('returns an empty array when there are no sessions', () => {
    expect(sessions.all()).toEqual([]);
  });

  it('returns every session, newest-created first', () => {
    clock.set('2026-07-14T00:00:01.000Z');
    sessions.create({ id: 'first' });
    clock.set('2026-07-14T00:00:02.000Z');
    sessions.create({ id: 'second' });
    clock.set('2026-07-14T00:00:03.000Z');
    sessions.create({ id: 'third' });

    expect(sessions.all().map((s) => s.id)).toEqual(['third', 'second', 'first']);
  });
});

describe('sessions.has / count', () => {
  it('reports existence', () => {
    sessions.create({ id: 'a' });
    expect(sessions.has('a')).toBe(true);
    expect(sessions.has('b')).toBe(false);
  });

  it('counts sessions', () => {
    expect(sessions.count()).toBe(0);
    sessions.create({ id: 'a' });
    sessions.create({ id: 'b' });
    expect(sessions.count()).toBe(2);
  });
});

describe('sessions.touch', () => {
  it('advances updatedAt while leaving createdAt and id unchanged', () => {
    clock.set('2026-07-14T00:00:00.000Z');
    const created = sessions.create({ id: 'a' });

    clock.set('2026-07-14T09:30:00.000Z');
    const touched = sessions.touch('a');

    expect(touched).toBeDefined();
    expect(touched?.id).toBe('a');
    expect(touched?.createdAt).toBe(created.createdAt);
    expect(touched?.updatedAt).toBe('2026-07-14T09:30:00.000Z');
    // Persisted, not just returned.
    expect(sessions.get('a')?.updatedAt).toBe('2026-07-14T09:30:00.000Z');
  });

  it('returns undefined when the session does not exist', () => {
    expect(sessions.touch('nope')).toBeUndefined();
  });

  it('validates the id', () => {
    expect(() => sessions.touch('a/b')).toThrow();
  });
});

describe('sessions.delete', () => {
  it('removes a session and reports true', () => {
    sessions.create({ id: 'a' });
    expect(sessions.delete('a')).toBe(true);
    expect(sessions.has('a')).toBe(false);
  });

  it('reports false when the id was absent', () => {
    expect(sessions.delete('nope')).toBe(false);
  });

  it('validates the id', () => {
    expect(() => sessions.delete('a/b')).toThrow();
  });

  it('lets an id be recreated after deletion', () => {
    sessions.create({ id: 'a' });
    sessions.delete('a');
    expect(() => sessions.create({ id: 'a' })).not.toThrow();
  });
});
