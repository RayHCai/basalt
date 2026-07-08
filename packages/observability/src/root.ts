import pino, { multistream } from 'pino';
import type { Logger, StreamEntry } from 'pino';
import pinoPretty from 'pino-pretty';

import { createFileStream } from './file-stream.js';
import { resolveLevel } from './levels.js';
import type { LogLevel } from './levels.js';

/** Namespace prefixed to every subsystem, yielding tags like `basalt.config`. */
const SUBSYSTEM_PREFIX = 'basalt';

/** JSON key under which the human-readable message is stored (not pino's `msg`). */
const MESSAGE_KEY = 'message';

/** Options shared by the root-building entry points. */
interface RootOptions {
  /** Minimum level to emit. Falls back to env (`BASALT_LOG_LEVEL`) then `info`. */
  level?: LogLevel | undefined;
  /** Extra bindings attached to every record from this root. */
  bindings?: Readonly<Record<string, unknown>> | undefined;
  /** Env map for level + path resolution. Pass `{}` to ignore the environment. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Write rotating JSONL files. Default `true`. */
  file?: boolean | undefined;
  /** Mirror output to the console via pino-pretty. Default `true`. */
  console?: boolean | undefined;
  /** Force console color on/off; defaults to pino-pretty's TTY detection. */
  color?: boolean | undefined;
  /** Size threshold before a log file rotates, e.g. `'10m'`. */
  maxFileSize?: string | number | undefined;
  /** Override the base log-file path (mainly for tests). */
  filePath?: string | undefined;
}

/**
 * A built root logger plus the subsystem prefix. `getLogger` derives every
 * package-scoped child from this handle.
 */
interface RootHandle {
  root: Logger;
  prefix: string;
}

/**
 * pino's `StreamEntry` level type excludes `'silent'`. Nothing is ever written
 * at `silent` (pino gates it out), but the stream must still declare a valid
 * level — coerce the sentinel to the lowest real level.
 */
function streamLevel(level: LogLevel): Exclude<LogLevel, 'silent'> {
  return level === 'silent' ? 'trace' : level;
}

/**
 * Build the shared root logger. Asynchronous because opening the rotating file
 * stream touches the filesystem.
 *
 * The root is deliberately **bare** — no `subsystem` in its bindings — because
 * pino does not dedupe binding keys: if the root carried `subsystem` and a child
 * added another, every line would contain the key twice. Instead each usable
 * logger is exactly one `.child({ subsystem })` deep (see `getLogger`).
 */
async function buildRoot(options: RootOptions = {}): Promise<RootHandle> {
  const level = resolveLevel(options.level, options.env ?? process.env);
  const writeFile = options.file ?? true;
  const writeConsole = options.console ?? true;

  const streams: StreamEntry[] = [];

  if (writeFile) {
    const fileStream = await createFileStream({
      file: options.filePath,
      maxFileSize: options.maxFileSize,
      env: options.env,
    });
    streams.push({ level: streamLevel(level), stream: fileStream });
  }

  if (writeConsole) {
    // Only set `colorize` when explicitly requested; omitting it lets
    // pino-pretty auto-detect a TTY (exactOptionalPropertyTypes forbids passing
    // `undefined`).
    const pretty = pinoPretty({
      messageKey: MESSAGE_KEY,
      ignore: 'pid,hostname',
      ...(options.color === undefined ? {} : { colorize: options.color }),
    });
    streams.push({ level: streamLevel(level), stream: pretty });
  }

  const root = pino(
    {
      level,
      messageKey: MESSAGE_KEY,
      // Drop pino's default `pid`/`hostname`; `null` (not `undefined`) is
      // required under exactOptionalPropertyTypes.
      base: options.bindings ? { ...options.bindings } : null,
      // Emit the level NAME (`"info"`) instead of pino's numeric code.
      formatters: {
        level: (label) => ({ level: label }),
      },
      // ISO-8601 UTC timestamp in the `time` field.
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    multistream(streams, { dedupe: false }),
  );

  return { root, prefix: SUBSYSTEM_PREFIX };
}

export { buildRoot, type RootHandle, type RootOptions, SUBSYSTEM_PREFIX };
