import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { LOG_FILE_BASE } from './paths.js';

/** Days a rotated log file is kept before {@link pruneOldLogs} removes it. */
const DEFAULT_MAX_AGE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Matches rotated log files this package produces, e.g.
 * `basalt.2026-07-08.1.log`. Anchored so unrelated files in the directory are
 * never touched. The date/number segments are matched loosely — mtime, not the
 * name, decides age.
 */
const LOG_FILE_PATTERN = new RegExp(`^${LOG_FILE_BASE}\\.\\d{4}-\\d{2}-\\d{2}\\..*\\.log$`, 'u');

/** Result of a prune pass. */
interface PruneResult {
  /** Absolute paths that were removed. */
  removed: string[];
  /** Number of matching log files inspected. */
  scanned: number;
}

/**
 * Delete rotated log files in `dir` whose last-modified time is older than
 * `maxAgeDays`. pino-roll's own `limit` retains files by count, not age, so age
 * expiry is handled here.
 *
 * Never throws: a missing directory yields an empty result, and per-file errors
 * (permission, race with rotation) are skipped so a single bad file cannot
 * abort the sweep or crash the process during startup.
 */
async function pruneOldLogs(
  dir: string,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
  now: number = Date.now(),
): Promise<PruneResult> {
  const cutoff = now - maxAgeDays * MS_PER_DAY;

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return { removed: [], scanned: 0 };
  }

  const candidates = entries.filter((name) => LOG_FILE_PATTERN.test(name));
  const results = await Promise.all(
    candidates.map(async (name) => {
      const filePath = join(dir, name);
      try {
        const info = await stat(filePath);
        if (info.mtimeMs < cutoff) {
          await unlink(filePath);
          return filePath;
        }
      } catch {
        // Skip: file vanished, is locked, or is otherwise unreadable.
      }
      return '';
    }),
  );

  const removed = results.filter((path) => path.length > 0);
  return { removed, scanned: candidates.length };
}

export { DEFAULT_MAX_AGE_DAYS, pruneOldLogs, type PruneResult };
