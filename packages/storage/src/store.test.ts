import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_FILE_NAME } from './paths.js';
import { createStorageStore, MEMORY_DB } from './store.js';
import type { StorageStore } from './store.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-storage-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createStorageStore (on disk)', () => {
  it('creates the database file under the given dir', async () => {
    const store = await createStorageStore({ dir });
    store.sessions.create({ id: 'a' });
    const info = await stat(join(dir, DB_FILE_NAME));
    expect(info.isFile()).toBe(true);
    store.close();
  });

  it('creates the storage directory with 0700 permissions', async () => {
    const nested = join(dir, 'state', 'storage');
    const store = await createStorageStore({ dir: nested });
    const info = await stat(nested);
    expect(info.mode & 0o777).toBe(0o700);
    store.close();
  });

  it('persists sessions across store instances', async () => {
    const first = await createStorageStore({ dir });
    const created = first.sessions.create({ id: 'persisted' });
    first.close();

    const reopened = await createStorageStore({ dir });
    expect(reopened.sessions.get('persisted')).toEqual(created);
    reopened.close();
  });

  it('does not re-run migrations destructively on reopen', async () => {
    const first = await createStorageStore({ dir });
    first.sessions.create({ id: 'a' });
    first.sessions.create({ id: 'b' });
    first.close();

    const reopened = await createStorageStore({ dir });
    expect(reopened.sessions.count()).toBe(2);
    reopened.close();
  });
});

describe('createStorageStore (in memory)', () => {
  // oxlint-disable-next-line init-declarations
  let store: StorageStore;

  beforeEach(async () => {
    store = await createStorageStore({ dir: MEMORY_DB });
  });

  afterEach(() => {
    store.close();
  });

  it('wires a working sessions repository', () => {
    const session = store.sessions.create();
    expect(store.sessions.get(session.id)).toEqual(session);
    expect(store.sessions.all()).toEqual([session]);
  });

  it('writes no file to disk for :memory:', async () => {
    store.sessions.create();
    // The temp dir was made by beforeEach but MEMORY_DB should not touch it.
    await expect(stat(join(dir, DB_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses an injected clock for timestamps', async () => {
    const fixed = '2026-01-02T03:04:05.000Z';
    const clocked = await createStorageStore({ dir: MEMORY_DB, clock: () => fixed });
    const session = clocked.sessions.create();
    expect(session.createdAt).toBe(fixed);
    expect(session.updatedAt).toBe(fixed);
    clocked.close();
  });
});
