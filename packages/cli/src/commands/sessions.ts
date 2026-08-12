import type { CliContext } from '../context.js';
import { UsageError } from '../errors.js';
import { renderSessionEvent, renderSessionList } from '../render.js';

/** Parsed options for the `sessions` command. */
interface SessionsOptions {
  /** `--list`: print all active sessions. */
  list?: boolean | undefined;
  /** `--watch [id]`: stream a session (read-only). */
  watch?: string | boolean | undefined;
}

/**
 * Handle `basalt sessions`.
 *
 * - `--list` prints the active sessions.
 * - `--watch <id>` streams a session's events until it ends.
 * - With no flag, defaults to `--list` (the most useful zero-arg behavior).
 *
 * `--list` and `--watch` are mutually exclusive.
 */
async function runSessions(ctx: CliContext, options: SessionsOptions): Promise<void> {
  const wantsWatch = options.watch !== undefined && options.watch !== false;

  if (options.list && wantsWatch) {
    throw new UsageError('Pass only one of --list or --watch.');
  }

  if (wantsWatch) {
    await watch(ctx, options.watch);
    return;
  }

  // Default (and explicit --list): show the session list.
  const sessions = await ctx.storage.listSessions();
  ctx.stdout(renderSessionList(ctx.palette, sessions));
}

/** Stream a single session. Requires a concrete id argument. */
async function watch(ctx: CliContext, watchValue: string | boolean | undefined): Promise<void> {
  if (typeof watchValue !== 'string' || watchValue.length === 0) {
    throw new UsageError('--watch requires a session id, e.g. `basalt sessions --watch <id>`.');
  }

  ctx.stdout(ctx.palette.dim(`Watching session ${watchValue} (read-only; Ctrl-C to stop)…`));
  const stream = await ctx.storage.watchSession(watchValue);
  for await (const event of stream) {
    ctx.stdout(renderSessionEvent(ctx.palette, event));
  }
}

export { runSessions };
