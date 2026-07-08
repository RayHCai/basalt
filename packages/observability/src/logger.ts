import pino from 'pino';
import type { Logger } from 'pino';
import pinoPretty from 'pino-pretty';

import { pruneOldLogs } from './cleanup.js';
import { resolveLevel } from './levels.js';
import { logsDir } from './paths.js';
import { buildRoot, SUBSYSTEM_PREFIX } from './root.js';
import type { RootHandle, RootOptions } from './root.js';

const MESSAGE_KEY = 'message';

/**
 * Build a synchronous, console-only bootstrap root. Used before
 * `configureRootLogger` runs (and if it never does) so `getLogger` always
 * returns a working logger — one that prints to the console but writes no files
 * (opening the rotating file stream is async).
 */
function buildBootstrapRoot(): RootHandle {
  const level = resolveLevel(undefined, process.env);
  const root = pino(
    {
      level,
      messageKey: MESSAGE_KEY,
      base: null,
      formatters: { level: (label) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pinoPretty({ messageKey: MESSAGE_KEY, ignore: 'pid,hostname' }),
  );
  return { root, prefix: SUBSYSTEM_PREFIX };
}

// oxlint-disable-next-line init-declarations
let rootHandle: RootHandle | undefined;
// Memoized child view of the current root (see getRootLogger). Cleared whenever
// the root is replaced so its identity stays stable between calls.
// oxlint-disable-next-line init-declarations
let rootView: Logger | undefined;

function currentHandle(): RootHandle {
  rootHandle ??= buildBootstrapRoot();
  return rootHandle;
}

/**
 * Get a logger scoped to a subsystem (typically a package name). The returned
 * logger is a raw pino {@link Logger} tagged `basalt.<subsystem>`, so call it
 * with the fields object FIRST: `log.info({ userId }, 'created session')`.
 *
 * Synchronous and safe to call at any time: before `configureRootLogger` it is
 * backed by a console-only bootstrap root; afterwards, newly requested loggers
 * use the configured (file + console) root.
 */
function getLogger(subsystem: string): Logger {
  const { root, prefix } = currentHandle();
  return root.child({ subsystem: `${prefix}.${subsystem}` });
}

/** The shared root logger as a stable, memoized single-child view. */
function getRootLogger(): Logger {
  const { root, prefix } = currentHandle();
  rootView ??= root.child({ subsystem: prefix });
  return rootView;
}

/** Replace the shared root with an explicit handle or bare pino logger. */
function setRootLogger(next: RootHandle | Logger): void {
  rootHandle = 'root' in next ? next : { root: next, prefix: SUBSYSTEM_PREFIX };
  rootView = undefined;
}

/**
 * Install the shared file-backed root and kick off a background prune of logs
 * older than 30 days. Idempotent-friendly: calling it again swaps the root.
 * Await it during startup once the state directory is known.
 */
async function configureRootLogger(options: RootOptions = {}): Promise<Logger> {
  const handle = await buildRoot(options);
  setRootLogger(handle);

  if (options.file ?? true) {
    const dir = logsDir(options.env);
    // Fire-and-forget: prune must never block or crash startup. pruneOldLogs
    // itself never throws, but guard the scheduling regardless.
    void (async (): Promise<void> => {
      try {
        await pruneOldLogs(dir);
      } catch {
        // Intentionally swallowed — cleanup is best-effort.
      }
    })();
  }

  return getRootLogger();
}

/**
 * Build a standalone file-backed root WITHOUT touching the shared module state.
 * Useful for isolated subsystems or tests that need their own sink.
 */
async function createLogger(options: RootOptions = {}): Promise<Logger> {
  const { root, prefix } = await buildRoot(options);
  return root.child({ subsystem: prefix });
}

export { configureRootLogger, createLogger, getLogger, getRootLogger, setRootLogger };
