import { describe, expect, it } from 'vitest';

import { PrimaryAlreadyClaimedError } from './errors.js';
import { isProcessAlive } from './process.js';
import { isPrimaryLive } from './sessions.js';
import type { Session } from './sessions.js';
import { createStorageStore, MEMORY_DB } from './store.js';
import type { StorageStore } from './store.js';

/** A pid high enough that it is almost certainly not a live process. */
const DEAD_PID = 2_147_483;

function openStore(): Promise<StorageStore> {
  return createStorageStore({ dir: MEMORY_DB });
}

describe('primary session', () => {
  describe('claimPrimary', () => {
    it('creates a primary session with role and pid', async () => {
      const store = await openStore();
      const session = store.sessions.claimPrimary(process.pid);

      expect(session.role).toBe('primary');
      expect(session.pid).toBe(process.pid);
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeTruthy();
      store.close();
    });

    it('throws PrimaryAlreadyClaimedError when a live primary exists', async () => {
      const store = await openStore();
      store.sessions.claimPrimary(process.pid);

      expect(() => store.sessions.claimPrimary(process.pid)).toThrow(PrimaryAlreadyClaimedError);
      store.close();
    });

    it('reclaims a stale primary (dead pid)', async () => {
      const store = await openStore();
      store.sessions.claimPrimary(DEAD_PID);

      // Should reclaim because the pid is dead.
      const fresh = store.sessions.claimPrimary(process.pid);
      expect(fresh.role).toBe('primary');
      expect(fresh.pid).toBe(process.pid);
      store.close();
    });

    it('enforces at-most-one via partial unique index', async () => {
      const store = await openStore();
      store.sessions.claimPrimary(process.pid);

      // A direct create with role='primary' hits the unique index.
      expect(() => store.sessions.create({ role: 'primary', pid: 99_999 })).toThrow();
      store.close();
    });
  });

  describe('getPrimary', () => {
    it('returns undefined when no primary exists', async () => {
      const store = await openStore();
      expect(store.sessions.getPrimary()).toBeUndefined();
      store.close();
    });

    it('returns the primary session', async () => {
      const store = await openStore();
      const claimed = store.sessions.claimPrimary(process.pid);
      const fetched = store.sessions.getPrimary();

      expect(fetched).toEqual({
        id: claimed.id,
        createdAt: claimed.createdAt,
        updatedAt: claimed.updatedAt,
        role: 'primary',
        pid: process.pid,
      });
      store.close();
    });
  });

  describe('releasePrimary', () => {
    it('deletes the primary session and returns true', async () => {
      const store = await openStore();
      const session = store.sessions.claimPrimary(process.pid);
      const released = store.sessions.releasePrimary(session.id);

      expect(released).toBe(true);
      expect(store.sessions.getPrimary()).toBeUndefined();
      store.close();
    });

    it('returns false when no primary with that id exists', async () => {
      const store = await openStore();
      expect(store.sessions.releasePrimary('nonexistent-id')).toBe(false);
      store.close();
    });

    it('frees the slot so a new primary can be claimed', async () => {
      const store = await openStore();
      const first = store.sessions.claimPrimary(process.pid);
      store.sessions.releasePrimary(first.id);

      const second = store.sessions.claimPrimary(process.pid);
      expect(second.id).not.toBe(first.id);
      expect(second.role).toBe('primary');
      store.close();
    });
  });

  describe('v2 migration', () => {
    it('adds role and pid columns to existing sessions', async () => {
      const store = await openStore();
      const session = store.sessions.create();

      expect(session.role).toBeNull();
      expect(session.pid).toBeNull();
      store.close();
    });
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a dead pid', () => {
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });
});

describe('isPrimaryLive', () => {
  it('returns true for a primary session with a live pid', () => {
    const session: Session = {
      id: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      role: 'primary',
      pid: process.pid,
    };
    expect(isPrimaryLive(session)).toBe(true);
  });

  it('returns false for a primary session with a dead pid', () => {
    const session: Session = {
      id: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      role: 'primary',
      pid: DEAD_PID,
    };
    expect(isPrimaryLive(session)).toBe(false);
  });

  it('returns false for a non-primary session', () => {
    const session: Session = {
      id: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      role: null,
      pid: null,
    };
    expect(isPrimaryLive(session)).toBe(false);
  });

  it('returns false when pid is null', () => {
    const session: Session = {
      id: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      role: 'primary',
      pid: null,
    };
    expect(isPrimaryLive(session)).toBe(false);
  });
});
