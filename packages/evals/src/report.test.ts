import { describe, expect, it } from 'vitest';

import type { CellMetrics, RunRecord } from './record.js';
import { renderReport, renderScatter, renderTable, toScatterPoints } from './report.js';

function cell(overrides: Partial<CellMetrics>): CellMetrics {
  return {
    task: 'niah_single_1',
    nominalLength: 8192,
    attempts: 1,
    accuracy: 0,
    meanScore: 0,
    meanInputTokens: 8192,
    meanCachedInputTokens: 0,
    meanOutputTokens: 1,
    meanPeakContextTokens: 8193,
    meanTurns: 1,
    ...overrides,
  };
}

function record(runId: string, accuracy: number, meanInputTokens: number): RunRecord {
  return {
    version: 1,
    runId,
    createdAt: '2026-07-12T17:41:12.000Z',
    params: {
      fraction: 1,
      lengths: [8192, 32_768],
      tasks: ['niah_single_1', 'vt'],
      maxSamplesPerTask: null,
      reps: 1,
      temperature: 0,
      maxInputTokens: null,
      maxTurns: null,
      provider: 'dummy',
      model: 'dummy-model',
    },
    results: [],
    metrics: {
      attempts: 4,
      accuracy,
      meanScore: accuracy,
      meanInputTokens,
      meanOutputTokens: 1,
      cells: [
        cell({ task: 'niah_single_1', nominalLength: 8192, accuracy }),
        cell({ task: 'niah_single_1', nominalLength: 32_768, accuracy: 0 }),
        cell({ task: 'vt', nominalLength: 8192, accuracy }),
      ],
    },
  };
}

describe('toScatterPoints', () => {
  it('reduces each run to (runId, meanInputTokens, accuracy)', () => {
    const points = toScatterPoints([record('a', 0.5, 8000)]);
    expect(points).toEqual([{ runId: 'a', meanInputTokens: 8000, accuracy: 0.5 }]);
  });
});

describe('renderScatter', () => {
  it('notes when there are no runs', () => {
    expect(renderScatter([])).toBe('No runs to plot.');
  });

  it('plots points with a legend', () => {
    const out = renderScatter(toScatterPoints([record('run-a', 0.8, 8000)]));
    expect(out).toContain('Accuracy vs. input tokens');
    expect(out).toContain('run-a');
    expect(out).toContain('acc 80.0%');
  });

  it('places a perfect-accuracy run at the top row and zero at the bottom', () => {
    const perfect = renderScatter(toScatterPoints([record('p', 1, 8000)])).split('\n');
    // The first plotted row (label 1.0) should carry the marker.
    const topRow = perfect.find((line) => line.trimStart().startsWith('1.0'));
    expect(topRow).toContain('#');
  });
});

describe('renderTable', () => {
  it('renders a task × length accuracy grid with a summary', () => {
    const out = renderTable(record('run-a', 0.5, 8192));
    expect(out).toContain('Run run-a');
    expect(out).toContain('dummy/dummy-model');
    expect(out).toContain('niah_single_1');
    expect(out).toContain('8K');
    expect(out).toContain('32K');
    expect(out).toContain('overall accuracy 50.0%');
    expect(out).toContain('4 attempts');
  });

  it('shows a dash for an absent cell', () => {
    const rec = record('run-a', 0.5, 8192);
    // vt only has an 8K cell, so its 32K column should be a dash.
    const out = renderTable(rec);
    const vtRow = out.split('\n').find((line) => line.startsWith('vt'));
    expect(vtRow).toContain('-');
  });
});

describe('renderReport', () => {
  it('notes when there are no runs', () => {
    expect(renderReport([])).toContain('No eval runs found');
  });

  it('combines the scatter and per-run tables', () => {
    const out = renderReport([record('run-a', 0.5, 8000), record('run-b', 0.9, 40_000)]);
    expect(out).toContain('Accuracy vs. input tokens');
    expect(out).toContain('Run run-a');
    expect(out).toContain('Run run-b');
  });
});
