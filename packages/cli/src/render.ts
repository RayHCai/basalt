import type { Palette } from './colors.js';
import type { CronJobInfo, SessionEvent, SessionInfo } from './domain.js';

/**
 * Pure formatting helpers: value + palette in, styled string out. No IO, no
 * process access — the command handlers do the writing. Keeping these pure
 * makes the (fiddly) formatting logic directly unit-testable.
 */

/** Status → palette color, so session state reads at a glance. */
function colorStatus(palette: Palette, status: SessionInfo['status']): string {
  switch (status) {
    case 'running': {
      return palette.green(status);
    }
    case 'idle': {
      return palette.cyan(status);
    }
    case 'error': {
      return palette.red(status);
    }
    case 'done': {
      return palette.dim(status);
    }
    default: {
      return status;
    }
  }
}

/** Render a single session as one line. */
function renderSessionLine(palette: Palette, session: SessionInfo): string {
  const parent =
    session.parentId === null ? palette.dim('(top-level)') : `parent ${session.parentId}`;
  return [
    palette.bold(session.id),
    colorStatus(palette, session.status),
    parent,
    palette.dim(session.startedAt),
    session.task,
  ].join('  ');
}

/**
 * Render the full session list, or a friendly empty-state message. The empty
 * case is what the shell runtime produces today.
 */
function renderSessionList(palette: Palette, sessions: readonly SessionInfo[]): string {
  if (sessions.length === 0) {
    return palette.dim('No active sessions.');
  }
  const header = palette.bold(`${sessions.length} active session(s):`);
  const lines = sessions.map((session) => `  ${renderSessionLine(palette, session)}`);
  return [header, ...lines].join('\n');
}

/** Render a single cron job as one line. */
function renderCronLine(palette: Palette, job: CronJobInfo): string {
  const state =
    job.sessionId === null
      ? palette.dim('idle')
      : palette.green(`in progress (session ${job.sessionId})`);
  return [
    palette.bold(job.id),
    palette.cyan(job.schedule),
    `next ${palette.dim(job.nextRun)}`,
    state,
  ].join('  ');
}

/** Render the full cron list, or a friendly empty-state message. */
function renderCronList(palette: Palette, jobs: readonly CronJobInfo[]): string {
  if (jobs.length === 0) {
    return palette.dim('No cron jobs registered.');
  }
  const header = palette.bold(`${jobs.length} cron job(s):`);
  const lines = jobs.map((job) => `  ${renderCronLine(palette, job)}`);
  return [header, ...lines].join('\n');
}

/** Render a single streamed session event as one line. */
function renderSessionEvent(palette: Palette, event: SessionEvent): string {
  return `${palette.dim(event.at)} ${palette.cyan(event.kind)}  ${event.text}`;
}

/**
 * The prompt marker shown at the start of each interactive input line. A
 * cherry-blossom accent chevron, kept as its own function so the REPL and its
 * tests agree on exactly what the user sees.
 */
function renderPromptMarker(palette: Palette): string {
  return `${palette.accent('▶')} `;
}

/**
 * Render the interactive REPL's welcome banner: a small basalt-themed splash
 * plus the handful of instructions a first-time user needs. Returned as one
 * multi-line string; the caller writes it.
 */
function renderReplBanner(palette: Palette): string {
  const title = palette.bold(palette.accent('◆ basalt'));
  const tagline = palette.gray('a small, lightweight CLI agent harness');
  const hints = [
    `${palette.gray('  •')} type a message and press ${palette.bold('Enter')} to send it to the agent`,
    `${palette.gray('  •')} ${palette.bold('/help')} for commands, ${palette.bold('/exit')} to quit`,
    `${palette.gray('  •')} ${palette.bold('Ctrl-C')} or ${palette.bold('Ctrl-D')} also quits`,
  ];
  return [`${title}  ${tagline}`, '', ...hints, ''].join('\n');
}

/** The one-line help shown for the REPL's `/help` command. */
function renderReplHelp(palette: Palette): string {
  return [
    palette.bold('Commands:'),
    `  ${palette.cyan('/help')}   show this help`,
    `  ${palette.cyan('/exit')}   leave the prompt (aliases: /quit, /q)`,
    palette.gray('Anything else is sent to the agent as a message.'),
  ].join('\n');
}

/** The farewell line printed when the interactive prompt closes. */
function renderGoodbye(palette: Palette): string {
  return palette.gray('Bye.');
}

export {
  renderCronLine,
  renderCronList,
  renderGoodbye,
  renderPromptMarker,
  renderReplBanner,
  renderReplHelp,
  renderSessionEvent,
  renderSessionList,
};
