import { DEFAULT_SESSION } from '@basalt/agent';
import type { Session as AgentSession } from '@basalt/agent';
import { storageDir } from '@basalt/config';
import { createStorageStore, isPrimaryLive } from '@basalt/storage';
import type { StorageStore } from '@basalt/storage';

import { NoPrimarySessionError, StalePrimarySessionError } from './errors.js';

/**
 * Handle returned by {@link startPrimary} representing the running primary
 * session service. The caller (`basalt start`) holds this for the lifetime of
 * the service and calls {@link release} on shutdown.
 */
interface PrimaryService {
  /** The agent-facing session (real id from storage, provider/model from defaults). */
  readonly session: AgentSession;
  /** Release the primary (delete the row + close storage). The kill switch. */
  release: () => void;
}

/** Options for {@link startPrimary}. */
interface StartPrimaryOptions {
  /** Process pid to record on the primary row. Defaults to `process.pid`. */
  pid?: number;
  /** Injected storage store (for testing). When provided, the caller owns closing it. */
  store?: StorageStore;
}

/** Options for {@link resolvePrimary}. */
interface ResolvePrimaryOptions {
  /** Injected storage store (for testing). When provided, the caller owns closing it. */
  store?: StorageStore;
}

/**
 * Claim the singleton primary session. Opens storage, inserts the primary row,
 * and returns a handle the caller holds until shutdown. On a live conflict,
 * `PrimaryAlreadyClaimedError` (from `@basalt/storage`) propagates.
 */
async function startPrimary(opts: StartPrimaryOptions = {}): Promise<PrimaryService> {
  const pid = opts.pid ?? process.pid;
  const ownsStore = opts.store === undefined;
  const store = opts.store ?? (await createStorageStore({ dir: storageDir() }));

  try {
    const storageSession = store.sessions.claimPrimary(pid);
    const session: AgentSession = {
      id: storageSession.id,
      provider: DEFAULT_SESSION.provider,
      model: DEFAULT_SESSION.model,
    };

    return {
      session,
      release(): void {
        store.sessions.releasePrimary(storageSession.id);
        if (ownsStore) {
          store.close();
        }
      },
    };
  } catch (error) {
    // A failed claim (live primary already held) must not leak a store we opened.
    if (ownsStore) {
      store.close();
    }
    throw error;
  }
}

/**
 * Resolve the live primary session as an agent `Session`. Opens storage, reads
 * the primary row, checks liveness, and returns the agent-facing session.
 * Throws {@link NoPrimarySessionError} when no primary exists, and
 * {@link StalePrimarySessionError} when the row's owning process is dead.
 */
async function resolvePrimary(opts: ResolvePrimaryOptions = {}): Promise<AgentSession> {
  const ownsStore = opts.store === undefined;
  const store = opts.store ?? (await createStorageStore({ dir: storageDir() }));

  try {
    const primary = store.sessions.getPrimary();
    if (!primary) {
      throw new NoPrimarySessionError();
    }
    if (!isPrimaryLive(primary)) {
      throw new StalePrimarySessionError(primary.pid ?? 0);
    }
    return {
      id: primary.id,
      provider: DEFAULT_SESSION.provider,
      model: DEFAULT_SESSION.model,
    };
  } finally {
    if (ownsStore) {
      store.close();
    }
  }
}

export {
  type PrimaryService,
  type ResolvePrimaryOptions,
  resolvePrimary,
  type StartPrimaryOptions,
  startPrimary,
};
