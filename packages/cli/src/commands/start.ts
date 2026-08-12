import { once } from 'node:events';
import { watch } from 'node:fs';
import { readdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import { stateDir } from '@basalt/config';

import type { Palette } from '../colors.js';
import type { CliContext } from '../context.js';

/** Bytes read per change notification while tailing — one comfortable chunk. */
const READ_CHUNK_BYTES = 65_536;

/** pino level thresholds: >=50 is error/fatal, >=40 is warn; info (30) is the default. */
const LEVEL_ERROR = 50;
const LEVEL_WARN = 40;
const LEVEL_INFO = 30;

/** Width the logger name is padded to so messages line up in the tail. */
const NAME_COLUMN_WIDTH = 8;

/**
 * `basalt start` — claim the primary session, print a banner, tail the shared
 * JSONL log, and block until SIGINT/SIGTERM. On termination, release the
 * primary (delete the row — the kill switch for any in-flight client turn) and
 * exit cleanly.
 */
async function runStart(ctx: CliContext): Promise<void> {
  const service = await ctx.startPrimary({ pid: process.pid });

  ctx.stdout(renderBanner(ctx, service.session.id));

  const ac = new AbortController();

  const cleanup = (): void => {
    ac.abort();
    service.release();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await tailLogs(ctx, ac.signal);
  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    // Ensure release even if tailLogs throws for a reason other than abort.
    if (!ac.signal.aborted) {
      service.release();
    }
  }
}

function renderBanner(ctx: CliContext, sessionId: string): string {
  const { green, dim } = ctx.palette;
  return [
    '',
    green('  ▶ basalt service running'),
    `    ${dim('session')}  ${sessionId}`,
    `    ${dim('pid')}      ${process.pid.toString()}`,
    '',
    dim('    Tailing logs… (Ctrl-C to stop)'),
    '',
  ].join('\n');
}

/**
 * Resolve once `signal` aborts. Shutdown is a normal outcome for `basalt start`,
 * not a fault, so this settles rather than rejecting and leaves the caller's
 * `finally` blocks to do the cleanup.
 */
async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await once(signal, 'abort');
}

/**
 * Tail the newest JSONL log file in `<STATE_DIR>/.logs/`, pretty-printing each
 * appended line until the signal aborts. Handles the case where no log file
 * exists yet (waits for the signal instead).
 */
async function tailLogs(ctx: CliContext, signal: AbortSignal): Promise<void> {
  const logFile = await resolveNewestLog(join(stateDir(), '.logs'));
  if (logFile === undefined) {
    // No log files yet — nothing to tail, so just block until shutdown.
    await waitForAbort(signal);
    return;
  }

  const fileHandle = await open(logFile, 'r');
  try {
    // Start at the current end of the file so only newly appended lines print.
    const stats = await fileHandle.stat();
    let position = stats.size;

    const readAppended = async (): Promise<void> => {
      try {
        const buf = Buffer.alloc(READ_CHUNK_BYTES);
        const { bytesRead } = await fileHandle.read(buf, 0, buf.length, position);
        if (bytesRead === 0) {
          return;
        }
        position += bytesRead;

        const text = buf.subarray(0, bytesRead).toString('utf8');
        for (const line of text.split('\n')) {
          if (line.trim().length > 0) {
            ctx.stdout(formatLogLine(ctx, line));
          }
        }
      } catch {
        // The handle can close under us mid-read during shutdown. Either way the
        // tail is over, and this runs detached from the watch callback, so there
        // is nobody to report to.
      }
    };

    // Read appended bytes on each change notification. Detached on purpose: the
    // watcher callback is synchronous and `readAppended` swallows its own faults.
    const watcher = watch(logFile, () => {
      void readAppended();
    });
    try {
      await waitForAbort(signal);
    } finally {
      watcher.close();
    }
  } finally {
    await fileHandle.close();
  }
}

async function resolveNewestLog(dir: string): Promise<string | undefined> {
  try {
    const entries = await readdir(dir);
    const newest = entries
      .filter((file) => file.startsWith('basalt.') && file.endsWith('.log'))
      .toSorted()
      .at(-1);
    return newest === undefined ? undefined : join(dir, newest);
  } catch {
    return undefined;
  }
}

/** Pick the styling function for a pino level: red for error, yellow for warn. */
function levelColor(palette: Palette, level: number): (text: string) => string {
  if (level >= LEVEL_ERROR) {
    return palette.red;
  }
  if (level >= LEVEL_WARN) {
    return palette.yellow;
  }
  return palette.dim;
}

function formatLogLine(ctx: CliContext, raw: string): string {
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    const time = typeof record['time'] === 'number' ? new Date(record['time']) : new Date();
    const hh = time.getHours().toString().padStart(2, '0');
    const mm = time.getMinutes().toString().padStart(2, '0');
    const ss = time.getSeconds().toString().padStart(2, '0');
    const timestamp = `${hh}:${mm}:${ss}`;

    const name = String(record['name'] ?? '').replace(/^basalt\./u, '');
    const msg = String(record['msg'] ?? '');

    // Collect extra bindings (skip standard pino fields).
    const skip = new Set(['level', 'time', 'pid', 'hostname', 'name', 'msg', 'v']);
    const bindings = Object.entries(record)
      .filter(([key]) => !skip.has(key))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ');

    const colorFn = levelColor(ctx.palette, Number(record['level'] ?? LEVEL_INFO));
    const suffix = bindings.length > 0 ? `  ${ctx.palette.dim(bindings)}` : '';

    return `${colorFn(`[${timestamp}]`)} ${ctx.palette.dim(name.padEnd(NAME_COLUMN_WIDTH))} ${msg}${suffix}`;
  } catch {
    return ctx.palette.dim(raw);
  }
}

export { runStart };
