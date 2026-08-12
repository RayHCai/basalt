import { createConfigSection, initConfig, setSecret } from '@basalt/config';
import { evaluate, loadAllRuns, loadData } from '@basalt/evals';
import { run as runtimeRun } from '@basalt/runtime';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import { PLAIN } from './colors.js';
import type { CliContext } from './context.js';
import { UsageError } from './errors.js';
import { buildProgram, PROGRAM_NAME, toCliError } from './program.js';
import { defaultStorageReader } from './storage.js';

function makeContext(): { ctx: CliContext; out: string[]; err: string[] } {
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
    storage: defaultStorageReader,
    palette: PLAIN,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    openPrompter: () => ({ question: () => Promise.resolve(null), close: () => {} }),
  };
  return { ctx, out, err };
}

describe('buildProgram', () => {
  it('names the program and registers the expected subcommands', () => {
    const { ctx } = makeContext();
    const program = buildProgram(ctx);
    expect(program.name()).toBe(PROGRAM_NAME);
    const names = program.commands.map((c) => c.name()).toSorted();
    expect(names).toEqual(['config', 'cron', 'evaluate', 'init', 'secret', 'sessions', 'start']);
  });

  it('routes output through the context writers', () => {
    const { ctx, out } = makeContext();
    const program = buildProgram(ctx);
    program.outputHelp();
    expect(out.join('\n')).toContain('Basalt');
  });
});

describe('toCliError', () => {
  it('returns undefined for a help exit (clean)', () => {
    expect(toCliError(new CommanderError(0, 'commander.help', ''))).toBeUndefined();
  });

  it('returns undefined for a version exit (clean)', () => {
    expect(toCliError(new CommanderError(0, 'commander.version', '1.0.0'))).toBeUndefined();
  });

  it('maps a genuine parse error to a UsageError', () => {
    const mapped = toCliError(new CommanderError(1, 'commander.unknownOption', 'unknown option'));
    expect(mapped).toBeInstanceOf(UsageError);
    expect(mapped?.message).toBe('unknown option');
  });
});
