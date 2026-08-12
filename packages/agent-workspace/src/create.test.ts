import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { create } from './create.js';

// oxlint-disable-next-line init-declarations
let dir: string;

/** Point both the state dir and the workspace base at a throwaway temp dir. */
function testEnv(): Record<string, string> {
  return { BASALT_STATE_DIR: dir };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-agent-workspace-create-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('create', () => {
  it('creates the session cwd under .agent-workspace/sessions/<id> and reports it as new', async () => {
    const result = await create('session-123', { env: testEnv() });

    expect(result.id).toBe('session-123');
    expect(result.dir).toBe(join(dir, '.agent-workspace', 'sessions', 'session-123'));
    expect(result.created).toBe(true);
    const stats = await stat(result.dir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('is idempotent — retrieving an existing session returns the same dir with created=false', async () => {
    const first = await create('session-abc', { env: testEnv() });
    const second = await create('session-abc', { env: testEnv() });

    expect(second.dir).toBe(first.dir);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('preserves files already written into an existing session dir', async () => {
    const first = await create('session-keep', { env: testEnv() });
    const marker = join(first.dir, 'artifact.txt');
    await writeFile(marker, 'hello');

    await create('session-keep', { env: testEnv() });

    expect(await stat(marker)).toBeTruthy();
  });

  it('keeps sibling sessions isolated in their own subdirectories', async () => {
    const a = await create('session-a', { env: testEnv() });
    const b = await create('session-b', { env: testEnv() });

    expect(a.dir).not.toBe(b.dir);
    expect(a.dir).toBe(join(dir, '.agent-workspace', 'sessions', 'session-a'));
    expect(b.dir).toBe(join(dir, '.agent-workspace', 'sessions', 'session-b'));
  });

  it('honors BASALT_AGENT_WORKSPACE_DIR, rooting sessions outside the state dir', async () => {
    const workspaceBase = await mkdtemp(join(tmpdir(), 'basalt-agent-workspace-base-'));
    try {
      const env = { BASALT_STATE_DIR: dir, BASALT_AGENT_WORKSPACE_DIR: workspaceBase };
      const result = await create('session-x', { env });

      expect(result.dir).toBe(join(workspaceBase, '.agent-workspace', 'sessions', 'session-x'));
      expect(result.dir.startsWith(dir)).toBe(false);
    } finally {
      await rm(workspaceBase, { recursive: true, force: true });
    }
  });

  it('rejects a session id that is not a valid name (no path traversal reaches disk)', async () => {
    await expect(create('../escape', { env: testEnv() })).rejects.toThrow();
    await expect(create('', { env: testEnv() })).rejects.toThrow();
    await expect(create('Bad Name', { env: testEnv() })).rejects.toThrow();
  });
});
