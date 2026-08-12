import { storageDir } from '@basalt/config';
import { NotImplementedError } from '@basalt/runtime';
import { createStorageStore, isPrimaryLive } from '@basalt/storage';
import type { Session as StorageSession, StorageStore } from '@basalt/storage';

import type { CronJobInfo, SessionEvent, SessionInfo } from './domain.js';

/**
 * The read-only view of session + cron state the `sessions` and `cron` commands
 * need. Backed by `@basalt/storage`: `listSessions` opens the DB (lazily, once)
 * and maps the rows. `watchSession` is still unimplemented (no event bus yet).
 */
interface StorageReader {
  /** All sessions, with the primary marked as 'running' when live. */
  listSessions: () => Promise<readonly SessionInfo[]>;
  /** All registered cron jobs (empty until cron is implemented). */
  listCronJobs: () => Promise<readonly CronJobInfo[]>;
  /** Stream a session's events read-only (not yet implemented). */
  watchSession: (sessionId: string) => Promise<AsyncIterable<SessionEvent>>;
}

/**
 * Build an async iterable that throws {@link NotImplementedError} the moment it
 * is iterated — a well-typed stream today that is honest that no events can flow
 * until the session/agent layer exists.
 */
function notImplementedStream(feature: string): AsyncIterable<SessionEvent> {
  return {
    // oxlint-disable-next-line require-yield -- intentionally throws before yielding
    async *[Symbol.asyncIterator](): AsyncIterator<SessionEvent> {
      throw new NotImplementedError(feature);
    },
  };
}

function mapSession(session: StorageSession): SessionInfo {
  const status: SessionInfo['status'] = isPrimaryLive(session) ? 'running' : 'idle';
  return {
    id: session.id,
    parentId: null,
    status,
    task: '',
    startedAt: session.createdAt,
  };
}

/**
 * Build a real storage reader backed by `@basalt/storage`. The store is opened
 * lazily on first use and cached for the process lifetime.
 */
function createRealStorageReader(): StorageReader {
  // Cache the PROMISE, not the resolved store: concurrent first calls then share
  // one open rather than racing to open the database twice.
  let storePromise: Promise<StorageStore> | null = null;

  function getStore(): Promise<StorageStore> {
    storePromise ??= createStorageStore({ dir: storageDir() });
    return storePromise;
  }

  return {
    async listSessions(): Promise<readonly SessionInfo[]> {
      const store = await getStore();
      return store.sessions.all().map((session) => mapSession(session));
    },
    listCronJobs: () => Promise.resolve([]),
    watchSession: (sessionId: string) =>
      Promise.resolve(notImplementedStream(`watching session ${sessionId}`)),
  };
}

/**
 * The shell storage reader — returns empty results without touching storage.
 * Useful in tests where no real DB should be opened.
 */
const defaultStorageReader: StorageReader = {
  listSessions: () => Promise.resolve([]),
  listCronJobs: () => Promise.resolve([]),
  watchSession: (sessionId: string) =>
    Promise.resolve(notImplementedStream(`watching session ${sessionId}`)),
};

export { createRealStorageReader, defaultStorageReader, type StorageReader };
