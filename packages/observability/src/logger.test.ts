import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, getLogger, setRootLogger } from './logger.js';
import { LOGS_DIR_NAME } from './paths.js';
import { buildRoot } from './root.js';

// oxlint-disable-next-line init-declarations
let dir: string;

interface LogRecord {
  level: string;
  time: string;
  subsystem?: string;
  message?: string;
  [key: string]: unknown;
}

/** Read and JSONL-parse every `*.log` line currently in `logsPath`. */
async function readAllLines(logsPath: string): Promise<string[]> {
  const files = await readdir(logsPath);
  const logs = files.filter((name) => name.endsWith('.log'));
  const contents = await Promise.all(logs.map((name) => readFile(join(logsPath, name), 'utf8')));
  return contents
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

/** Poll the logs dir until at least `min` JSONL records are readable. */
async function readRecords(logsPath: string, min: number): Promise<LogRecord[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      // Sequential by design: poll the growing file, then wait and re-check.
      // oxlint-disable-next-line no-await-in-loop
      const lines = await readAllLines(logsPath);
      if (lines.length >= min) {
        return lines.map((line) => JSON.parse(line) as LogRecord);
      }
    } catch {
      // dir/file not ready yet — retry below.
    }
    // Sequential by design: poll, wait, re-check.
    // oxlint-disable-next-line no-await-in-loop
    await delay(20);
  }
  throw new Error(`timed out waiting for ${min} log record(s) in ${logsPath}`);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-logger-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('file logging', () => {
  it('writes structured JSONL with the level name, ISO time and message', async () => {
    const log = await createLogger({
      env: { BASALT_STATE_DIR: dir },
      console: false,
      level: 'info',
    });
    log.info({ userId: 'u1' }, 'session created');

    const logsPath = join(dir, LOGS_DIR_NAME);
    const [record] = await readRecords(logsPath, 1);

    expect(record?.level).toBe('info');
    expect(record?.message).toBe('session created');
    expect(record?.['userId']).toBe('u1');
    // ISO-8601 UTC timestamp.
    expect(record?.time).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    // pino defaults dropped.
    expect(record).not.toHaveProperty('pid');
    expect(record).not.toHaveProperty('hostname');
  });

  it('names files basalt.<date>.<n>.log under .logs', async () => {
    const log = await createLogger({ env: { BASALT_STATE_DIR: dir }, console: false });
    log.warn('heads up');
    await readRecords(join(dir, LOGS_DIR_NAME), 1);

    const files = await readdir(join(dir, LOGS_DIR_NAME));
    expect(files.some((name) => /^basalt\.\d{4}-\d{2}-\d{2}\.\d+\.log$/u.test(name))).toBe(true);
  });

  it('tags each subsystem exactly once (no duplicate binding keys)', async () => {
    const { root } = await buildRoot({ env: { BASALT_STATE_DIR: dir }, console: false });
    setRootLogger(root);

    getLogger('config').info('from config');
    getLogger('secrets').info('from secrets');

    const records = await readRecords(join(dir, LOGS_DIR_NAME), 2);
    const subsystems = new Set(records.map((rec) => rec.subsystem));
    expect(subsystems.has('basalt.config')).toBe(true);
    expect(subsystems.has('basalt.secrets')).toBe(true);

    // A duplicated binding key would serialize as two `"subsystem":` tokens.
    for (const line of await readAllLines(join(dir, LOGS_DIR_NAME))) {
      expect(line.match(/"subsystem":/gu)?.length).toBe(1);
    }
  });

  it('suppresses records below the configured level', async () => {
    const log = await createLogger({
      env: { BASALT_STATE_DIR: dir },
      console: false,
      level: 'warn',
    });
    log.debug('noise');
    log.info('still noise');
    log.error('kept');

    const records = await readRecords(join(dir, LOGS_DIR_NAME), 1);
    expect(records).toHaveLength(1);
    expect(records[0]?.message).toBe('kept');
    expect(records[0]?.level).toBe('error');
  });
});
