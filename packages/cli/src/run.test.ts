import { NotImplementedError, run as runtimeRun } from '@basalt/runtime';
import type { Session } from '@basalt/runtime';
import { describe, expect, it } from 'vitest';

import type { RuntimeRun } from './context.js';
import { EXIT_CODES } from './errors.js';
import type { Prompter } from './prompt.js';
import { detectColorFlag, run } from './run.js';
import type { RunOptions } from './run.js';
import type { StorageReader } from './storage.js';

const TEST_SESSION: Session = { id: 'test', provider: 'anthropic', model: 'claude-haiku-4-5' };
const TEST_RESOLVE_PRIMARY = () => Promise.resolve(TEST_SESSION);

/** A prompter that immediately reports end-of-input, so the REPL exits at once. */
function emptyPrompter(): Prompter {
  return { question: () => Promise.resolve(null), close: () => {} };
}

/** Base env that disables color so assertions match plain strings. */
const NO_COLOR_ENV = { NO_COLOR: '1' } as const;

describe('detectColorFlag', () => {
  it('returns undefined with no flag', () => {
    expect(detectColorFlag(['sessions'])).toBeUndefined();
  });

  it('detects --color and --no-color, last one wins', () => {
    expect(detectColorFlag(['--color'])).toBe(true);
    expect(detectColorFlag(['--no-color'])).toBe(false);
    expect(detectColorFlag(['--color', '--no-color'])).toBe(false);
  });
});

describe('run', () => {
  it('lists sessions and exits 0 (shell → empty)', async () => {
    const code = await run({ argv: ['sessions', '--list'], env: NO_COLOR_ENV });
    expect(code).toBe(EXIT_CODES.ok);
  });

  it('lists cron jobs and exits 0', async () => {
    const code = await run({ argv: ['cron', '--list'], env: NO_COLOR_ENV });
    expect(code).toBe(EXIT_CODES.ok);
  });

  it('returns the software exit code when a runtime operation is still a shell', async () => {
    // A still-shelled runtime operation rejects with NotImplementedError, which
    // the CLI maps to the software exit code. Inject one rather than touching
    // the real runtime (which now runs a loop turn against disk).
    const shellRun = (() =>
      Promise.reject(
        new NotImplementedError('sending a message to the agent'),
      )) as unknown as RuntimeRun;
    const code = await run({
      argv: ['hello', 'world'],
      run: shellRun,
      resolvePrimary: TEST_RESOLVE_PRIMARY,
      env: NO_COLOR_ENV,
    });
    expect(code).toBe(EXIT_CODES.software);
  });

  it('runs init and exits 0 (init calls @basalt/config directly, not the runtime)', async () => {
    // Inject a fake initConfig so the test asserts the CLI wiring/exit code
    // without seeding config into the repo working directory.
    let initialized = false;
    const fakeInit = (() => {
      initialized = true;
      // Cast through unknown: the CLI runner only needs the call to resolve; the
      // exact result shape is config's concern and may grow section kinds.
      return Promise.resolve({
        store: {},
        seeded: true,
        stateDir: '/tmp',
        configDir: '/tmp/config',
        secretsDir: '/tmp/secrets',
        mainConfigPath: '/tmp/config/main.json',
        modelProviders: [],
        plugins: [],
        tools: [],
        mcpServers: [],
      });
    }) as unknown as RunOptions['initConfig'];
    const code = await run({ argv: ['init'], initConfig: fakeInit, env: NO_COLOR_ENV });
    expect(code).toBe(EXIT_CODES.ok);
    expect(initialized).toBe(true);
  });

  it('returns a usage exit code for an unknown flag', async () => {
    const code = await run({ argv: ['sessions', '--nope'], env: NO_COLOR_ENV });
    expect(code).toBe(EXIT_CODES.usage);
  });

  it('opens the interactive prompt for a bare invocation and exits 0', async () => {
    // Bare `basalt` now drops into the REPL; an immediately-empty prompter
    // makes it greet-and-leave, which is a clean exit.
    const code = await run({
      argv: [],
      env: NO_COLOR_ENV,
      openPrompter: emptyPrompter,
      resolvePrimary: TEST_RESOLVE_PRIMARY,
    });
    expect(code).toBe(EXIT_CODES.ok);
  });

  it('exits 0 for --help (a clean commander exit, not an error)', async () => {
    const code = await run({ argv: ['--help'], env: NO_COLOR_ENV });
    expect(code).toBe(EXIT_CODES.ok);
  });

  it('exits 0 for --version', async () => {
    const code = await run({ argv: ['--version'], env: NO_COLOR_ENV });
    expect(code).toBe(EXIT_CODES.ok);
  });

  it('delegates the message to an injected run and exits 0', async () => {
    const sent: string[] = [];
    const fakeRun = ((request: { kind: string; message?: string }) => {
      if (request.kind === 'sendMessage' && request.message !== undefined) {
        sent.push(request.message);
        return Promise.resolve('test');
      }
      return runtimeRun(request as Parameters<typeof runtimeRun>[0]);
    }) as RuntimeRun;
    const code = await run({
      argv: ['hi', 'there'],
      run: fakeRun,
      resolvePrimary: TEST_RESOLVE_PRIMARY,
      env: NO_COLOR_ENV,
    });
    expect(code).toBe(EXIT_CODES.ok);
    expect(sent).toEqual(['hi there']);
  });

  it('renders an unexpected (non-runtime) error as exit code 1', async () => {
    // sessions reads storage; a storage reader that throws a plain Error is an
    // unexpected crash → exit 1.
    const brokenStorage = {
      listSessions: () => Promise.reject(new Error('disk on fire')),
      listCronJobs: () => Promise.resolve([]),
      watchSession: () => Promise.reject(new Error('unused')),
    } as StorageReader;
    const code = await run({
      argv: ['sessions', '--list'],
      storage: brokenStorage,
      env: NO_COLOR_ENV,
    });
    expect(code).toBe(EXIT_CODES.failure);
  });
});
