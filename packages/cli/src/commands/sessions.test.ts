import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { NotImplementedError, run as runtimeRun } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { createConfigSection, initConfig, setSecret } from '@basalt/config';

import { PLAIN } from '../colors.js';
import type { CliContext } from '../context.js';
import type { SessionEvent, SessionInfo } from '../domain.js';
import { UsageError } from '../errors.js';
import { defaultStorageReader } from '../storage.js';
import type { StorageReader } from '../storage.js';
import { runSessions } from './sessions.js';

/** Build a context with a given storage reader (defaults to the shell reader). */
function makeContext(storage: StorageReader = defaultStorageReader): {
  ctx: CliContext;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
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
    stderr: (text) => err.push(text),
    openPrompter: () => ({ question: () => Promise.resolve(null), close: () => {} }),
  };
  return { ctx, out, err };
}

describe('runSessions', () => {
  it('lists sessions by default (no flags)', async () => {
    const { ctx, out } = makeContext();
    await runSessions(ctx, {});
    expect(out).toEqual(['No active sessions.']);
  });

  it('lists sessions with --list', async () => {
    const session: SessionInfo = {
      id: 'sess-1',
      parentId: null,
      status: 'running',
      task: 'work',
      startedAt: '2026-07-08T00:00:00.000Z',
    };
    const { ctx, out } = makeContext({
      ...defaultStorageReader,
      listSessions: () => Promise.resolve([session]),
    });
    await runSessions(ctx, { list: true });
    expect(out[0]).toContain('1 active session(s):');
    expect(out[0]).toContain('sess-1');
  });

  it('rejects passing both --list and --watch', async () => {
    const { ctx } = makeContext();
    await expect(runSessions(ctx, { list: true, watch: 'sess-1' })).rejects.toBeInstanceOf(
      UsageError,
    );
  });

  it('requires an id when --watch is a bare flag', async () => {
    const { ctx } = makeContext();
    await expect(runSessions(ctx, { watch: true })).rejects.toBeInstanceOf(UsageError);
  });

  it('streams events for --watch <id>', async () => {
    const events: SessionEvent[] = [
      { at: '2026-07-08T00:00:00.000Z', kind: 'message', text: 'hi' },
      { at: '2026-07-08T00:00:01.000Z', kind: 'status', text: 'done' },
    ];
    const stream: AsyncIterable<SessionEvent> = {
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    };
    const { ctx, out } = makeContext({
      ...defaultStorageReader,
      watchSession: () => Promise.resolve(stream),
    });
    await runSessions(ctx, { watch: 'sess-1' });
    expect(out[0]).toContain('Watching session sess-1');
    expect(out.join('\n')).toContain('hi');
    expect(out.join('\n')).toContain('done');
  });

  it('propagates NotImplementedError from the shell storage watch', async () => {
    const { ctx } = makeContext();
    await expect(runSessions(ctx, { watch: 'sess-1' })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
