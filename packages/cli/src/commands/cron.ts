import type { CliContext } from '../context.js';
import { renderCronList } from '../render.js';

/** Parsed options for the `cron` command. */
interface CronOptions {
  /** `--list`: print all registered cron jobs. */
  list?: boolean | undefined;
}

/**
 * Handle `basalt cron`.
 *
 * Currently `--list` is the only operation (and the default): it prints every
 * registered cron job, its schedule, next run, and the session id attached to
 * it when a run is in progress.
 */
async function runCron(ctx: CliContext, _options: CronOptions): Promise<void> {
  const jobs = await ctx.storage.listCronJobs();
  ctx.stdout(renderCronList(ctx.palette, jobs));
}

export { runCron };
