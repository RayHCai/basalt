import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluate } from './evaluate.js';
import { loadRun } from './store.js';

// The committed synthetic fixtures stand in for a generated .ruler-data tree, so
// evaluate() is exercised end to end without the (git-ignored) real datasets.
const FIXTURES = join(import.meta.dirname, 'ruler', '__fixtures__');

// oxlint-disable-next-line init-declarations
let dir: string;
// oxlint-disable-next-line init-declarations
let env: Record<string, string>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-evals-evaluate-'));
  env = { BASALT_STATE_DIR: dir };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FIXED_CLOCK = Date.UTC(2026, 6, 12, 17, 41, 12);

/** A harness wiring that never touches disk: dummy config + constant response. */
const dummyHarness = {
  provider: 'dummy',
  model: 'dummy-model',
  configureConfig: () => Promise.resolve(),
  start: () => Promise.resolve('test'),
};

describe('evaluate', () => {
  it('runs the full pipeline end to end with the dummy provider', async () => {
    const { record, path } = await evaluate({
      load: { dataDir: FIXTURES, tasks: ['niah_single_1'], lengths: [8192] },
      harness: dummyHarness,
      env,
      clock: () => FIXED_CLOCK,
    });

    // 3 fixture samples × one rep = three attempts, all failed (dummy → "test").
    expect(record.metrics.attempts).toBe(3);
    expect(record.metrics.accuracy).toBe(0);
    expect(record.results.every((r) => !r.passed)).toBe(true);
    expect(record.params.provider).toBe('dummy');
    expect(path).not.toBeNull();
  });

  it('persists a readable record under STATE_DIR/evals/results', async () => {
    const { record } = await evaluate({
      load: { dataDir: FIXTURES, tasks: ['qa_1'], lengths: [8192] },
      harness: dummyHarness,
      env,
      clock: () => FIXED_CLOCK,
    });
    const reloaded = await loadRun(record.runId, { env });
    expect(reloaded.runId).toBe(record.runId);
    expect(reloaded.metrics.attempts).toBe(2);
  });

  it('honors persist: false (no file written, store path null)', async () => {
    const { path } = await evaluate({
      load: { dataDir: FIXTURES, tasks: ['cwe'], lengths: [8192] },
      harness: dummyHarness,
      env,
      clock: () => FIXED_CLOCK,
      persist: false,
    });
    expect(path).toBeNull();
  });

  it('records the reps and captures provenance in params', async () => {
    const { record } = await evaluate({
      load: { dataDir: FIXTURES, tasks: ['niah_single_1'], lengths: [8192], maxSamplesPerTask: 1 },
      reps: 3,
      harness: dummyHarness,
      env,
      clock: () => FIXED_CLOCK,
    });
    // 1 task × 1 length × 1 sample × 3 reps = 3 attempts.
    expect(record.metrics.attempts).toBe(3);
    expect(record.params.reps).toBe(3);
    expect(record.params.temperature).toBe(0);
    expect(record.params.lengths).toEqual([8192]);
    expect(record.params.tasks).toEqual(['niah_single_1']);
    expect(record.params.maxSamplesPerTask).toBe(1);
  });

  it('builds a timestamped, provider-suffixed run id', async () => {
    const { record } = await evaluate({
      load: { dataDir: FIXTURES, tasks: ['niah_single_1'], lengths: [8192] },
      harness: dummyHarness,
      env,
      clock: () => FIXED_CLOCK,
    });
    expect(record.runId).toBe('run-20260712T174112-dummy');
  });

  it('applies an input-token cap across the run', async () => {
    const { record } = await evaluate({
      load: { dataDir: FIXTURES, tasks: ['niah_single_1'], lengths: [8192] },
      harness: dummyHarness,
      env,
      clock: () => FIXED_CLOCK,
      // fixture samples are ~42 tokens; cap below that so every attempt is skipped.
      maxInputTokens: 10,
    });
    expect(record.results.every((r) => r.error?.includes('exceeds cap'))).toBe(true);
    expect(record.params.maxInputTokens).toBe(10);
  });
});
