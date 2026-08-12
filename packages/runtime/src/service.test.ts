import { createStorageStore, MEMORY_DB, PrimaryAlreadyClaimedError } from '@basalt/storage';
import { describe, expect, it } from 'vitest';

import { NoPrimarySessionError, StalePrimarySessionError } from './errors.js';
import { resolvePrimary, startPrimary } from './service.js';

/** A pid high enough that it is almost certainly not a live process. */
const DEAD_PID = 2_147_483;

describe('startPrimary', () => {
  it('claims and returns a PrimaryService with the session', async () => {
    const store = await createStorageStore({ dir: MEMORY_DB });
    const service = await startPrimary({ pid: process.pid, store });

    expect(service.session.id).toBeTruthy();
    expect(service.session.provider).toBe('anthropic');
    expect(service.session.model).toBe('claude-haiku-4-5');

    service.release();
    store.close();
  });

  it('propagates PrimaryAlreadyClaimedError on a live conflict', async () => {
    const store = await createStorageStore({ dir: MEMORY_DB });
    await startPrimary({ pid: process.pid, store });

    await expect(startPrimary({ pid: process.pid, store })).rejects.toThrow(
      PrimaryAlreadyClaimedError,
    );
    store.close();
  });

  it('release deletes the primary row', async () => {
    const store = await createStorageStore({ dir: MEMORY_DB });
    const service = await startPrimary({ pid: process.pid, store });

    service.release();
    expect(store.sessions.getPrimary()).toBeUndefined();
    store.close();
  });
});

describe('resolvePrimary', () => {
  it('returns the agent session when a live primary exists', async () => {
    const store = await createStorageStore({ dir: MEMORY_DB });
    store.sessions.claimPrimary(process.pid);

    const session = await resolvePrimary({ store });
    expect(session.id).toBeTruthy();
    expect(session.provider).toBe('anthropic');
    expect(session.model).toBe('claude-haiku-4-5');
    store.close();
  });

  it('throws NoPrimarySessionError when no primary exists', async () => {
    const store = await createStorageStore({ dir: MEMORY_DB });

    await expect(resolvePrimary({ store })).rejects.toThrow(NoPrimarySessionError);
    store.close();
  });

  it('throws StalePrimarySessionError when the pid is dead', async () => {
    const store = await createStorageStore({ dir: MEMORY_DB });
    store.sessions.claimPrimary(DEAD_PID);

    await expect(resolvePrimary({ store })).rejects.toThrow(StalePrimarySessionError);
    store.close();
  });
});
