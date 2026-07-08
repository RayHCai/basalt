import { isAbsolute, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOG_FILE_BASE,
  LOGS_DIR_NAME,
  logFileBase,
  logsDir,
  STATE_DIR_ENV_VAR,
  stateDir,
} from './paths.js';

describe('paths', () => {
  it('defaults the state dir to the current working directory', () => {
    expect(stateDir({})).toBe(process.cwd());
  });

  it('honors an absolute BASALT_STATE_DIR override', () => {
    expect(stateDir({ [STATE_DIR_ENV_VAR]: '/var/lib/basalt' })).toBe('/var/lib/basalt');
  });

  it('resolves a relative BASALT_STATE_DIR against cwd', () => {
    const resolved = stateDir({ [STATE_DIR_ENV_VAR]: 'state' });
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(join(process.cwd(), 'state'));
  });

  it('ignores an empty override', () => {
    expect(stateDir({ [STATE_DIR_ENV_VAR]: '' })).toBe(process.cwd());
  });

  it('places logs under <STATE_DIR>/.logs', () => {
    const dir = '/srv/basalt';
    expect(logsDir({ [STATE_DIR_ENV_VAR]: dir })).toBe(join(dir, LOGS_DIR_NAME));
  });

  it('builds the log file base as <logs>/basalt', () => {
    const dir = '/srv/basalt';
    expect(logFileBase({ [STATE_DIR_ENV_VAR]: dir })).toBe(join(dir, LOGS_DIR_NAME, LOG_FILE_BASE));
  });
});
