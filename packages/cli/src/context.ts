import {
  createConfigSection as configCreateSection,
  initConfig as configInitConfig,
  setSecret as configSetSecret,
} from '@basalt/config';
import {
  evaluate as evalsEvaluate,
  loadAllRuns as evalsLoadAllRuns,
  loadData as evalsLoadData,
} from '@basalt/evals';
import {
  resolvePrimary as runtimeResolvePrimary,
  run as runtimeRun,
  startPrimary as runtimeStartPrimary,
} from '@basalt/runtime';
import type { PrimaryService, Session } from '@basalt/runtime';

import { selectPalette } from './colors.js';
import type { Palette } from './colors.js';
import { openNodePrompter } from './prompt.js';
import type { OpenPrompter } from './prompt.js';
import { createSecretValueReader } from './secret-input.js';
import type { ReadSecretValue } from './secret-input.js';
import { createRealStorageReader } from './storage.js';
import type { StorageReader } from './storage.js';

/**
 * The runtime's `run` entry point — the seam for RUNNING THE AGENT (a one-shot
 * message or the REPL). The CLI delegates only agent execution through this;
 * the other subcommands go straight to their owning package.
 *
 * Typed as the real runtime's signature so call sites get full type narrowing.
 * Test doubles satisfy this via `as RuntimeRun`.
 */
type RuntimeRun = typeof runtimeRun;

/** `@basalt/config`'s init entry — the seam for `basalt init`. */
type InitConfig = typeof configInitConfig;

/** `@basalt/config`'s section-create entry — the seam for `basalt config create-*`. */
type CreateConfigSection = typeof configCreateSection;

/** `@basalt/config`'s set-secret entry — the seam for `basalt secret set`. */
type SetSecret = typeof configSetSecret;

/** `@basalt/evals`' evaluate entry — the seam for `basalt evaluate`. */
type Evaluate = typeof evalsEvaluate;

/** `@basalt/evals`' stored-run loader — the seam for `basalt evaluate report`. */
type LoadEvalRuns = typeof evalsLoadAllRuns;

/** `@basalt/evals`' dataset generator/loader — the seam for `basalt evaluate load`. */
type LoadEvalData = typeof evalsLoadData;

/** Resolve the live primary session — the seam for `basalt <message>` / REPL. */
type ResolvePrimary = () => Promise<Session>;

/** Claim the primary session — the seam for `basalt start`. */
type StartPrimary = (opts?: { pid?: number }) => Promise<PrimaryService>;

/** A minimal sink for a line of text. Both `process.stdout` writers and test
 * doubles satisfy this. */
type Writer = (text: string) => void;

/**
 * Everything a command handler needs to do its job, injected rather than
 * reached for globally. This keeps handlers pure-ish and trivially testable:
 * a test builds a context with capturing writers and a fake `run`.
 */
interface CliContext {
  /** Run the agent (`basalt <message>` / REPL) via `@basalt/runtime`. */
  run: RuntimeRun;
  /** Resolve the live primary session for `basalt <message>` / REPL. */
  resolvePrimary: ResolvePrimary;
  /** Claim the primary session for `basalt start`. */
  startPrimary: StartPrimary;
  /** Initialize config (`basalt init`) via `@basalt/config`. */
  initConfig: InitConfig;
  /** Create a config section (`basalt config create-*`) via `@basalt/config`. */
  createConfigSection: CreateConfigSection;
  /** Seal a secret (`basalt secret set`) via `@basalt/config`. */
  setSecret: SetSecret;
  /** Run an evaluation (`basalt evaluate`) via `@basalt/evals`. */
  evaluate: Evaluate;
  /** Load stored eval runs (`basalt evaluate report`) via `@basalt/evals`. */
  loadEvalRuns: LoadEvalRuns;
  /** Generate + store the RULER datasets (`basalt evaluate load`) via `@basalt/evals`. */
  loadEvalData: LoadEvalData;
  /**
   * Read a secret VALUE from a safe source (piped stdin, or a no-echo TTY
   * prompt) — never from argv. Injected so the value never touches the command
   * line and tests can script it.
   */
  readSecretValue: ReadSecretValue;
  /** Read sessions + cron for the `sessions`/`cron` commands (via storage). */
  storage: StorageReader;
  /** Styling functions (color or plain, already resolved). */
  palette: Palette;
  /** Write a line to standard output. */
  stdout: Writer;
  /** Write a line to standard error. */
  stderr: Writer;
  /**
   * Open an interactive line-input source for the REPL. Injected (rather than
   * reached for globally) so the interactive prompt is testable with scripted
   * input and never touches stdin outside the REPL.
   */
  openPrompter: OpenPrompter;
}

/** Options for building the default, process-backed context. */
interface CreateContextOptions {
  /** Runtime entry point to delegate to. Defaults to `@basalt/runtime`'s `run`. */
  run?: RuntimeRun | undefined;
  /** Primary session resolver. Defaults to `@basalt/runtime`'s `resolvePrimary`. */
  resolvePrimary?: ResolvePrimary | undefined;
  /** Primary session claimer. Defaults to `@basalt/runtime`'s `startPrimary`. */
  startPrimary?: StartPrimary | undefined;
  /** Config init entry. Defaults to `@basalt/config`'s `initConfig`. */
  initConfig?: InitConfig | undefined;
  /** Config section-create entry. Defaults to `@basalt/config`'s `createConfigSection`. */
  createConfigSection?: CreateConfigSection | undefined;
  /** Set-secret entry. Defaults to `@basalt/config`'s `setSecret`. */
  setSecret?: SetSecret | undefined;
  /** Evaluate entry. Defaults to `@basalt/evals`' `evaluate`. */
  evaluate?: Evaluate | undefined;
  /** Stored-run loader. Defaults to `@basalt/evals`' `loadAllRuns`. */
  loadEvalRuns?: LoadEvalRuns | undefined;
  /** Dataset generator/loader. Defaults to `@basalt/evals`' `loadData`. */
  loadEvalData?: LoadEvalData | undefined;
  /** Secret-value reader. Defaults to the stdin-or-TTY-prompt reader. */
  readSecretValue?: ReadSecretValue | undefined;
  /** Session/cron reader. Defaults to the shell reader (until `@basalt/storage`). */
  storage?: StorageReader | undefined;
  /** Interactive input source opener. Defaults to a Node `readline` prompter. */
  openPrompter?: OpenPrompter | undefined;
  /**
   * Explicit color decision from `--color` / `--no-color`. When omitted, color
   * is auto-detected from `NO_COLOR`/`FORCE_COLOR`/TTY.
   */
  color?: boolean | undefined;
  /** Environment map (for color detection). Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
}

/** Append a newline and write to a Node stream. */
function streamWriter(stream: NodeJS.WriteStream): Writer {
  return (text: string): void => {
    stream.write(`${text}\n`);
  };
}

/**
 * Build the real, process-backed context: stdout/stderr wired to the process
 * streams, palette resolved from the environment + TTY, and the real runtime
 * `run` unless one is supplied.
 */
function createContext(options: CreateContextOptions = {}): CliContext {
  const env = options.env ?? process.env;
  const palette = selectPalette(options.color, Boolean(process.stdout.isTTY), env);
  return {
    run: options.run ?? runtimeRun,
    resolvePrimary: options.resolvePrimary ?? runtimeResolvePrimary,
    startPrimary: options.startPrimary ?? runtimeStartPrimary,
    initConfig: options.initConfig ?? configInitConfig,
    createConfigSection: options.createConfigSection ?? configCreateSection,
    setSecret: options.setSecret ?? configSetSecret,
    evaluate: options.evaluate ?? evalsEvaluate,
    loadEvalRuns: options.loadEvalRuns ?? evalsLoadAllRuns,
    loadEvalData: options.loadEvalData ?? evalsLoadData,
    readSecretValue: options.readSecretValue ?? createSecretValueReader(),
    storage: options.storage ?? createRealStorageReader(),
    palette,
    stdout: streamWriter(process.stdout),
    stderr: streamWriter(process.stderr),
    openPrompter: options.openPrompter ?? openNodePrompter,
  };
}

export {
  type CliContext,
  type CreateConfigSection,
  type CreateContextOptions,
  createContext,
  type Evaluate,
  type InitConfig,
  type LoadEvalData,
  type LoadEvalRuns,
  type RuntimeRun,
  type SetSecret,
  type Writer,
};
