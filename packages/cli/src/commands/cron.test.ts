import { createConfigSection, initConfig, setSecret } from '@basalt/config';
import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext } from '../context.js';
import type { CronJobInfo } from '../domain.js';
import { defaultStorageReader } from '../storage.js';
import type { StorageReader } from '../storage.js';
import { runCron } from './cron.js';

function makeContext(storage: StorageReader = defaultStorageReader): {
  ctx: CliContext;
  out: string[];
} {
  const out: string[] = [];
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
    storage,
    palette: PLAIN,
    stdout: (text) => out.push(text),
    stderr: () => {},
    openPrompter: () => ({ question: () => Promise.resolve(null), close: () => {} }),
  };
  return { ctx, out };
}

describe('runCron', () => {
  it('shows the empty state when no jobs are registered', async () => {
    const { ctx, out } = makeContext();
    await runCron(ctx, { list: true });
    expect(out).toEqual(['No cron jobs registered.']);
  });

  it('lists registered jobs', async () => {
    const job: CronJobInfo = {
      id: 'cron-1',
      schedule: '0 * * * *',
      nextRun: '2026-07-08T01:00:00.000Z',
      sessionId: 'sess-9',
    };
    const { ctx, out } = makeContext({
      ...defaultStorageReader,
      listCronJobs: () => Promise.resolve([job]),
    });
    await runCron(ctx, {});
    expect(out[0]).toContain('1 cron job(s):');
    expect(out[0]).toContain('cron-1');
    expect(out[0]).toContain('in progress (session sess-9)');
  });
});
