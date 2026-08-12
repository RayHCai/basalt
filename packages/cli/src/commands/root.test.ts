import { createConfigSection, initConfig, setSecret } from '@basalt/config';
import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { NotImplementedError, run as runtimeRun } from '@basalt/runtime';
import type { PrimaryService, Session } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import { PLAIN } from '../colors.js';
import type { CliContext, RuntimeRun } from '../context.js';
import type { Prompter } from '../prompt.js';
import { defaultStorageReader } from '../storage.js';
import { runRoot } from './root.js';

const TEST_SESSION: Session = {
  id: 'test-session',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
};
const TEST_PRIMARY_SERVICE: PrimaryService = { session: TEST_SESSION, release: () => {} };

/** Build a prompter that replays `lines`, then reports end-of-input (null). */
function scriptedPrompter(lines: readonly string[]): { prompter: Prompter; closed: () => boolean } {
  const queue = [...lines];
  let wasClosed = false;
  const prompter: Prompter = {
    question: () => Promise.resolve(queue.length > 0 ? (queue.shift() ?? null) : null),
    close: () => {
      wasClosed = true;
    },
  };
  return { prompter, closed: () => wasClosed };
}

function makeContext(
  run: RuntimeRun,
  prompter?: Prompter,
): { ctx: CliContext; sent: string[]; out: string[]; err: string[] } {
  const sent: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const wrapped = ((request: { kind: string; message?: string }) => {
    if (request.kind === 'sendMessage' && request.message !== undefined) {
      sent.push(request.message);
    }
    return run(request as Parameters<typeof runtimeRun>[0]);
  }) as RuntimeRun;
  const ctx: CliContext = {
    run: wrapped,
    resolvePrimary: () => Promise.resolve(TEST_SESSION),
    startPrimary: () => Promise.resolve(TEST_PRIMARY_SERVICE),
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
    stderr: (text) => err.push(text),
    openPrompter: () => prompter ?? { question: () => Promise.resolve(null), close: () => {} },
  };
  return { ctx, sent, out, err };
}

/** A runtime double whose `sendMessage` resolves to the dummy reply. */
const okRun = ((request: { kind: string }) => {
  if (request.kind === 'sendMessage') {
    return Promise.resolve('test');
  }
  return runtimeRun(request as Parameters<typeof runtimeRun>[0]);
}) as RuntimeRun;

/** A runtime double whose `sendMessage` rejects with NotImplementedError. */
const shellRun = ((request: { kind: string }) => {
  if (request.kind === 'sendMessage') {
    return Promise.reject(new NotImplementedError('sending a message to the agent'));
  }
  return runtimeRun(request as Parameters<typeof runtimeRun>[0]);
}) as RuntimeRun;

describe('runRoot (one-shot)', () => {
  it('joins message words and forwards them to the runtime', async () => {
    const { ctx, sent } = makeContext(okRun);
    await runRoot(ctx, ['do', 'the', 'thing']);
    expect(sent).toEqual(['do the thing']);
  });

  it('prints the reply the runtime returns', async () => {
    const { ctx, out } = makeContext(okRun);
    await runRoot(ctx, ['hi']);
    expect(out).toContain('test');
  });

  it('propagates a NotImplementedError from a still-shelled runtime', async () => {
    const { ctx } = makeContext(shellRun);
    await expect(runRoot(ctx, ['hi'])).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('runRoot (interactive REPL)', () => {
  it('opens the prompt with no message and greets with a banner', async () => {
    const { prompter } = scriptedPrompter([]);
    const { ctx, out } = makeContext(okRun, prompter);
    await runRoot(ctx, []);
    expect(out.join('\n')).toContain('basalt');
  });

  it('sends each entered line to the agent until end-of-input', async () => {
    const { prompter } = scriptedPrompter(['first', 'second']);
    const { ctx, sent } = makeContext(okRun, prompter);
    await runRoot(ctx, []);
    expect(sent).toEqual(['first', 'second']);
  });

  it('treats whitespace-only input as a no-op reprompt', async () => {
    const { prompter } = scriptedPrompter(['   ', 'real']);
    const { ctx, sent } = makeContext(okRun, prompter);
    await runRoot(ctx, []);
    expect(sent).toEqual(['real']);
  });

  it('leaves on /exit (and does not send it as a message)', async () => {
    const { prompter } = scriptedPrompter(['/exit', 'never']);
    const { ctx, sent } = makeContext(okRun, prompter);
    await runRoot(ctx, []);
    expect(sent).toEqual([]);
  });

  it('prints help for /help without sending it', async () => {
    const { prompter } = scriptedPrompter(['/help']);
    const { ctx, sent, out } = makeContext(okRun, prompter);
    await runRoot(ctx, []);
    expect(sent).toEqual([]);
    expect(out.join('\n')).toContain('Commands:');
  });

  it('closes the prompter and prints a goodbye on exit', async () => {
    const { prompter, closed } = scriptedPrompter(['/quit']);
    const { ctx, out } = makeContext(okRun, prompter);
    await runRoot(ctx, []);
    expect(closed()).toBe(true);
    expect(out.join('\n')).toContain('Bye.');
  });

  it('stays in the loop when a runtime operation is not implemented', async () => {
    // A still-shelled runtime throws NotImplementedError for sendMessage; the
    // REPL should report it inline and keep prompting, not bail out.
    const { prompter } = scriptedPrompter(['one', 'two']);
    const { ctx, sent, err } = makeContext(shellRun, prompter);
    await runRoot(ctx, []);
    expect(sent).toEqual(['one', 'two']);
    expect(err.join('\n')).toContain('not implemented');
  });
});
