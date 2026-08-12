import { describe, expect, it } from 'vitest';

import { isTask, TASK_METRIC, TASKS } from './task.js';

describe('TASKS', () => {
  it('is the 13 RULER v1 tasks', () => {
    expect(TASKS).toEqual([
      'niah_single_1',
      'niah_single_2',
      'niah_single_3',
      'niah_multikey_1',
      'niah_multikey_2',
      'niah_multikey_3',
      'niah_multivalue',
      'niah_multiquery',
      'vt',
      'cwe',
      'fwe',
      'qa_1',
      'qa_2',
    ]);
  });
});

describe('isTask', () => {
  it('recognizes every known task', () => {
    for (const task of TASKS) {
      expect(isTask(task)).toBe(true);
    }
  });

  it('rejects unknown task names', () => {
    expect(isTask('niah_single')).toBe(false);
    expect(isTask('unknown')).toBe(false);
    expect(isTask('')).toBe(false);
  });
});

describe('TASK_METRIC', () => {
  it('grades QA with string_match_part and everything else with string_match_all', () => {
    expect(TASK_METRIC.qa_1).toBe('string_match_part');
    expect(TASK_METRIC.qa_2).toBe('string_match_part');
    expect(TASK_METRIC.niah_single_1).toBe('string_match_all');
    expect(TASK_METRIC.vt).toBe('string_match_all');
    expect(TASK_METRIC.cwe).toBe('string_match_all');
    expect(TASK_METRIC.fwe).toBe('string_match_all');
  });

  it('assigns a metric to every task', () => {
    for (const task of TASKS) {
      expect(TASK_METRIC[task]).toMatch(/^string_match_(?:all|part)$/u);
    }
  });
});
