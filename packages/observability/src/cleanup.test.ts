import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MAX_AGE_DAYS, pruneOldLogs } from './cleanup.js';

const MS_PER_DAY = 86_400_000;

// oxlint-disable-next-line init-declarations
let dir: string;

async function touch(name: string, ageDays: number): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, 'log line\n');
  const when = new Date(Date.now() - ageDays * MS_PER_DAY);
  await utimes(filePath, when, when);
  return filePath;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-logs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pruneOldLogs', () => {
  it('removes matching files older than the max age, keeps fresh ones', async () => {
    await touch('basalt.2026-05-01.1.log', 45);
    await touch('basalt.2026-06-15.1.log', 40);
    await touch('basalt.2026-07-08.1.log', 1);

    const result = await pruneOldLogs(dir, DEFAULT_MAX_AGE_DAYS);

    expect(result.scanned).toBe(3);
    expect(result.removed).toHaveLength(2);
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['basalt.2026-07-08.1.log']);
  });

  it('only touches files that match the basalt log naming pattern', async () => {
    await touch('basalt.2026-01-01.1.log', 90);
    await touch('other.log', 90);
    // `basalt.log` has no date segment, so it is not a rotated file we own.
    await touch('basalt.log', 90);
    await touch('notes.txt', 90);

    const result = await pruneOldLogs(dir, DEFAULT_MAX_AGE_DAYS);

    expect(result.scanned).toBe(1);
    expect(result.removed).toHaveLength(1);
    const entries = await readdir(dir);
    expect(entries.toSorted()).toEqual(['basalt.log', 'notes.txt', 'other.log']);
  });

  it('respects a custom max age and injected clock', async () => {
    await touch('basalt.2026-07-01.1.log', 10);
    const now = Date.now();

    const kept = await pruneOldLogs(dir, 30, now);
    expect(kept.removed).toHaveLength(0);

    const pruned = await pruneOldLogs(dir, 5, now);
    expect(pruned.removed).toHaveLength(1);
  });

  it('returns an empty result for a missing directory without throwing', async () => {
    const result = await pruneOldLogs(join(dir, 'does-not-exist'));
    expect(result).toEqual({ removed: [], scanned: 0 });
  });
});
