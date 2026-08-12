import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DATA_DIR_NAME,
  dataDir,
  evalsDir,
  EVALS_DIR_NAME,
  RESULTS_DIR_NAME,
  resultsDir,
  RULER_DATA_DIR_ENV_VAR,
  runResultFile,
  STATE_DIR_ENV_VAR,
  taskFile,
} from './index.js';

describe('paths', () => {
  it('roots all eval state under <STATE_DIR>/evals', () => {
    const dir = '/srv/basalt';
    expect(evalsDir({ [STATE_DIR_ENV_VAR]: dir })).toBe(join(dir, EVALS_DIR_NAME));
    expect(EVALS_DIR_NAME).toBe('evals');
  });

  it('places datasets under <STATE_DIR>/evals/data', () => {
    const dir = '/srv/basalt';
    expect(dataDir({ [STATE_DIR_ENV_VAR]: dir })).toBe(join(dir, EVALS_DIR_NAME, DATA_DIR_NAME));
    expect(DATA_DIR_NAME).toBe('data');
  });

  it('places results under <STATE_DIR>/evals/results', () => {
    const dir = '/srv/basalt';
    expect(resultsDir({ [STATE_DIR_ENV_VAR]: dir })).toBe(
      join(dir, EVALS_DIR_NAME, RESULTS_DIR_NAME),
    );
    expect(RESULTS_DIR_NAME).toBe('results');
  });

  it('honors BASALT_RULER_DATA_DIR override for the dataset root', () => {
    expect(dataDir({ [RULER_DATA_DIR_ENV_VAR]: '/shared/ruler' })).toBe('/shared/ruler');
  });

  it('builds a per-task dataset file path', () => {
    expect(taskFile('/data', 8192, 'niah_single_1')).toBe(
      join('/data', '8192', 'niah_single_1', 'validation.jsonl'),
    );
  });

  it('builds a per-run record path under evals/results', () => {
    const dir = '/srv/basalt';
    expect(runResultFile('run-123', { [STATE_DIR_ENV_VAR]: dir })).toBe(
      join(dir, EVALS_DIR_NAME, RESULTS_DIR_NAME, 'run-123.json'),
    );
  });

  it('defaults the state dir to <cwd>/.basalt', () => {
    expect(evalsDir({})).toBe(join(process.cwd(), '.basalt', EVALS_DIR_NAME));
  });
});
