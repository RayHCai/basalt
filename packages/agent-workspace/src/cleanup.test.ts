import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentWorkspaceSharedDir } from '@basalt/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupSession, cleanupShared } from './cleanup.js';
import { create } from './create.js';

// oxlint-disable-next-line init-declarations
let dir: string;

/** Point the state dir (and thus the default workspace base) at a throwaway temp dir. */
function testEnv(): Record<string, string> {
  return { BASALT_STATE_DIR: dir };
}

/** `true` if `path` no longer exists. */
async function isGone(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-agent-workspace-cleanup-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('cleanupSession', () => {
  it('removes an existing session dir and its contents, reporting true', async () => {
    const session = await create('session-123', { env: testEnv() });
    await writeFile(join(session.dir, 'artifact.txt'), 'work');

    const removed = await cleanupSession('session-123', { env: testEnv() });

    expect(removed).toBe(true);
    expect(await isGone(session.dir)).toBe(true);
  });

  it('is tolerant of an absent session dir, reporting false', async () => {
    const removed = await cleanupSession('never-created', { env: testEnv() });
    expect(removed).toBe(false);
  });

  it('removes only the named session, leaving siblings intact', async () => {
    const a = await create('session-a', { env: testEnv() });
    const b = await create('session-b', { env: testEnv() });

    await cleanupSession('session-a', { env: testEnv() });

    expect(await isGone(a.dir)).toBe(true);
    expect(await isGone(b.dir)).toBe(false);
  });

  it('rejects a session id that is not a valid name (no traversal reaches disk)', async () => {
    await expect(cleanupSession('../escape', { env: testEnv() })).rejects.toThrow();
    await expect(cleanupSession('', { env: testEnv() })).rejects.toThrow();
  });
});

describe('cleanupShared', () => {
  it('removes a named entry under shared/ and its contents, reporting true', async () => {
    const env = testEnv();
    const sharedEntry = join(agentWorkspaceSharedDir(env), 'cache');
    // Seed a shared entry with content.
    await mkdir(sharedEntry, { recursive: true });
    await writeFile(join(sharedEntry, 'blob'), 'data');

    const removed = await cleanupShared('cache', { env });

    expect(removed).toBe(true);
    expect(await isGone(sharedEntry)).toBe(true);
  });

  it('is tolerant of an absent shared entry, reporting false', async () => {
    const removed = await cleanupShared('missing', { env: testEnv() });
    expect(removed).toBe(false);
  });

  it('rejects a shared name that is not a valid name (no traversal reaches disk)', async () => {
    await expect(cleanupShared('../../etc', { env: testEnv() })).rejects.toThrow();
    await expect(cleanupShared('', { env: testEnv() })).rejects.toThrow();
  });
});
