import { createConfigSection, initConfig, setSecret } from '@basalt/config';
import { loadAllRuns, loadData } from '@basalt/evals';
import type {
  EvaluateOptions,
  EvaluateResult,
  LoadDataResult,
  RunRecord,
  evaluate as evalsEvaluate,
  loadData as evalsLoadData,
} from '@basalt/evals';
import { run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultStorageReader } from '../storage.js';
import {
  buildEvaluateOptions,
  buildLoadDataOptions,
  runEvaluate,
  runEvaluateLoad,
  runEvaluateReport,
} from './evaluate.js';

function record(runId = 'run-1'): RunRecord {
  return {
    version: 1,
    runId,
    createdAt: '2026-07-12T17:41:12.000Z',
    params: {
      fraction: 1,
      lengths: [8192],
      tasks: ['niah_single_1'],
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
      attempts: 1,
      accuracy: 0,
      meanScore: 0,
      meanInputTokens: 8192,
      meanOutputTokens: 1,
      cells: [
        {
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
        },
      ],
    },
  };
}

interface Harness {
  ctx: CliContext;
  out: string[];
  calls: EvaluateOptions[];
}

function makeContext(overrides: Partial<CliContext> = {}): Harness {
  const out: string[] = [];
  const calls: EvaluateOptions[] = [];
  const evaluate = ((options: EvaluateOptions = {}): Promise<EvaluateResult> => {
    calls.push(options);
    return Promise.resolve({
      record: record(),
      path: '/tmp/.basalt/evaluation-results/run-1.json',
    });
  }) as typeof evalsEvaluate;
  const ctx: CliContext = {
    run: runtimeRun,
    resolvePrimary: () =>
      Promise.resolve({ id: 'test', provider: 'anthropic', model: 'claude-haiku-4-5' }),
    startPrimary: () =>
      Promise.resolve({
        session: { id: 'test', provider: 'anthropic', model: 'claude-haiku-4-5' },
        release: () => {},
      }),
    initConfig,
    createConfigSection,
    setSecret,
    evaluate,
    loadEvalRuns: loadAllRuns,
    loadEvalData: loadData,
    readSecretValue: () => Promise.resolve(''),
    storage: defaultStorageReader,
    palette: PLAIN,
    stdout: (text) => out.push(text),
    stderr: () => {},
    openPrompter: () => ({ question: () => Promise.resolve(null), close: () => {} }),
    ...overrides,
  };
  return { ctx, out, calls };
}

describe('buildEvaluateOptions', () => {
  it('parses a full set of flags into typed options', () => {
    const options = buildEvaluateOptions({
      fraction: '0.5',
      lengths: '8k,32k',
      tasks: 'niah_single_1,vt',
      maxSamples: '4',
      reps: '3',
      concurrency: '8',
      maxInputTokens: '100000',
      maxTurns: '10',
      provider: 'dummy',
      model: 'dummy-model',
    });
    expect(options.load).toEqual({
      fraction: 0.5,
      lengths: [8192, 32_768],
      tasks: ['niah_single_1', 'vt'],
      maxSamplesPerTask: 4,
    });
    expect(options.reps).toBe(3);
    expect(options.concurrency).toBe(8);
    expect(options.maxInputTokens).toBe(100_000);
    expect(options.maxTurns).toBe(10);
    expect(options.harness).toEqual({ provider: 'dummy', model: 'dummy-model' });
  });

  it('defaults to an empty load when no flags are given', () => {
    expect(buildEvaluateOptions({})).toEqual({ load: {} });
  });

  it('maps --no-store (store:false) to persist:false', () => {
    expect(buildEvaluateOptions({ store: false }).persist).toBe(false);
  });

  it('leaves persist unset when store is true or absent (evaluate defaults to persisting)', () => {
    expect(buildEvaluateOptions({ store: true }).persist).toBeUndefined();
    expect(buildEvaluateOptions({}).persist).toBeUndefined();
  });

  it('rejects an out-of-range --fraction', () => {
    expect(() => buildEvaluateOptions({ fraction: '0' })).toThrow(UsageError);
    expect(() => buildEvaluateOptions({ fraction: '2' })).toThrow(UsageError);
    expect(() => buildEvaluateOptions({ fraction: 'abc' })).toThrow(UsageError);
  });

  it('rejects an unsupported length', () => {
    expect(() => buildEvaluateOptions({ lengths: '16k' })).toThrow(UsageError);
    expect(() => buildEvaluateOptions({ lengths: 'garbage' })).toThrow(UsageError);
  });

  it('accepts the supported lengths', () => {
    expect(buildEvaluateOptions({ lengths: '8k,32k,128k' }).load?.lengths).toEqual([
      8192, 32_768, 131_072,
    ]);
  });

  it('rejects an unknown task', () => {
    expect(() => buildEvaluateOptions({ tasks: 'nope' })).toThrow(UsageError);
    expect(() => buildEvaluateOptions({ tasks: 'niah_single' })).toThrow(UsageError);
  });

  it('accepts known RULER tasks', () => {
    expect(buildEvaluateOptions({ tasks: 'niah_single_1,qa_1,fwe' }).load?.tasks).toEqual([
      'niah_single_1',
      'qa_1',
      'fwe',
    ]);
  });

  it('rejects a non-positive integer flag', () => {
    expect(() => buildEvaluateOptions({ maxSamples: '0' })).toThrow(UsageError);
    expect(() => buildEvaluateOptions({ reps: '-1' })).toThrow(UsageError);
    expect(() => buildEvaluateOptions({ concurrency: '1.5' })).toThrow(UsageError);
  });
});

describe('runEvaluate', () => {
  it('invokes evaluate with the parsed options and reports the stored run', async () => {
    const { ctx, out, calls } = makeContext();
    await runEvaluate(ctx, { fraction: '1', provider: 'dummy' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.load?.fraction).toBe(1);
    const joined = out.join('\n');
    expect(joined).toContain('Running evaluation…');
    expect(joined).toContain('dummy provider');
    expect(joined).toContain('Stored run run-1');
  });

  it('passes persist:false to evaluate and notes when a run is not stored (--no-store)', async () => {
    // Capture the options AND return path:null (what evaluate does under persist:false).
    const calls: EvaluateOptions[] = [];
    const evaluate = ((options: EvaluateOptions = {}): Promise<EvaluateResult> => {
      calls.push(options);
      return Promise.resolve({ record: record(), path: null });
    }) as typeof evalsEvaluate;
    const { ctx, out } = makeContext({ evaluate });
    await runEvaluate(ctx, { store: false });
    // The flag must actually reach evaluate — this is what the silent-ignore bug missed.
    expect(calls[0]?.persist).toBe(false);
    expect(out.join('\n')).toContain('Run not stored');
  });

  it('propagates a usage error from bad flags before invoking evaluate', async () => {
    const { ctx, calls } = makeContext();
    await expect(runEvaluate(ctx, { fraction: '5' })).rejects.toBeInstanceOf(UsageError);
    expect(calls).toHaveLength(0);
  });
});

describe('runEvaluateReport', () => {
  it('renders a friendly note when there are no runs', async () => {
    const { ctx, out } = makeContext({ loadEvalRuns: () => Promise.resolve([]) });
    await runEvaluateReport(ctx);
    expect(out.join('\n')).toContain('No eval runs found');
  });

  it('renders the scatter and tables for stored runs', async () => {
    const { ctx, out } = makeContext({
      loadEvalRuns: () => Promise.resolve([record('run-a'), record('run-b')]),
    });
    await runEvaluateReport(ctx);
    const joined = out.join('\n');
    expect(joined).toContain('Accuracy vs. input tokens');
    expect(joined).toContain('Run run-a');
    expect(joined).toContain('Run run-b');
  });
});

/** A stub LoadDataResult for the load-command tests. */
function loadResult(): LoadDataResult {
  return {
    dataDir: '/tmp/.basalt/evals/data',
    loaded: [{ task: 'niah_single_1', length: 8192, samples: 5 }],
    totalSamples: 5,
  };
}

describe('buildLoadDataOptions', () => {
  it('parses lengths, tasks, samples, and seed', () => {
    const options = buildLoadDataOptions({
      lengths: '8k,32k',
      tasks: 'niah_single_1,vt',
      samples: '10',
      seed: '7',
    });
    expect(options.lengths).toEqual([8192, 32_768]);
    expect(options.tasks).toEqual(['niah_single_1', 'vt']);
    expect(options.samples).toBe(10);
    expect(options.seed).toBe(7);
  });

  it('defaults to empty options when no flags are given', () => {
    expect(buildLoadDataOptions({})).toEqual({});
  });

  it('rejects an unknown task and a bad integer', () => {
    expect(() => buildLoadDataOptions({ tasks: 'nope' })).toThrow(UsageError);
    expect(() => buildLoadDataOptions({ samples: '0' })).toThrow(UsageError);
  });
});

describe('runEvaluateLoad', () => {
  it('invokes loadData with parsed options and reports the summary', async () => {
    const calls: unknown[] = [];
    const loadEvalData = ((options: unknown = {}): Promise<LoadDataResult> => {
      calls.push(options);
      return Promise.resolve(loadResult());
    }) as typeof evalsLoadData;
    const { ctx, out } = makeContext({ loadEvalData });

    await runEvaluateLoad(ctx, { tasks: 'niah_single_1', lengths: '8k' });

    const first = calls[0] as { tasks?: unknown; lengths?: unknown };
    expect(first.tasks).toEqual(['niah_single_1']);
    expect(first.lengths).toEqual([8192]);
    const joined = out.join('\n');
    expect(joined).toContain('Loading RULER datasets');
    expect(joined).toContain('Loaded 5 samples across 1');
  });

  it('propagates a usage error from bad flags before invoking loadData', async () => {
    const calls: unknown[] = [];
    const loadEvalData = ((options: unknown = {}): Promise<LoadDataResult> => {
      calls.push(options);
      return Promise.resolve(loadResult());
    }) as typeof evalsLoadData;
    const { ctx } = makeContext({ loadEvalData });
    await expect(runEvaluateLoad(ctx, { tasks: 'nope' })).rejects.toBeInstanceOf(UsageError);
    expect(calls).toHaveLength(0);
  });

  it('propagates a generation failure', async () => {
    const loadEvalData = (() =>
      Promise.reject(new Error('generator exited with code 1'))) as typeof evalsLoadData;
    const { ctx } = makeContext({ loadEvalData });
    await expect(runEvaluateLoad(ctx, {})).rejects.toThrow('generator exited');
  });
});
