import { NotImplementedError } from '@basalt/runtime';
import type { Session } from '@basalt/runtime';

import type { CliContext } from '../context.js';
import { renderGoodbye, renderPromptMarker, renderReplBanner, renderReplHelp } from '../render.js';

/** REPL inputs that leave the prompt. */
const EXIT_COMMANDS = new Set(['/exit', '/quit', '/q']);

/**
 * Handle the bare `basalt [message...]` command — the default action.
 *
 * Two modes:
 * - With words: joins them into a single prompt and sends it to the agent once
 *   (the one-shot form, `basalt "do X"`).
 * - Without words: drops into an interactive, Claude-Code-style prompt that
 *   reads messages line by line until the user exits.
 */
async function runRoot(ctx: CliContext, messageWords: readonly string[]): Promise<void> {
  const message = messageWords.join(' ').trim();
  if (message.length > 0) {
    const session = await ctx.resolvePrimary();
    const reply = await ctx.run({ kind: 'sendMessage', message, session });
    ctx.stdout(reply);
    return;
  }
  await runRepl(ctx);
}

/**
 * The interactive read-eval-print loop shown when `basalt` is run with no
 * message. Prints a themed banner, then repeatedly prompts for a line and
 * dispatches it: `/exit` (and aliases) quits, `/help` prints help, blank lines
 * are ignored, and anything else is sent to the agent.
 *
 * End-of-input (Ctrl-C, Ctrl-D, or a closed stream) also quits cleanly. The
 * loop is resilient: a `NotImplementedError` from a still-shelled runtime
 * operation is reported inline so the user stays in the prompt rather than being
 * kicked out — the whole point of the REPL is to keep the session open.
 */
async function runRepl(ctx: CliContext): Promise<void> {
  const session = await ctx.resolvePrimary();
  const prompter = ctx.openPrompter();
  ctx.stdout(renderReplBanner(ctx.palette));
  const marker = renderPromptMarker(ctx.palette);

  try {
    for (;;) {
      // A REPL is inherently sequential: each turn pauses and waits for the
      // user before the next. Parallelizing prompts makes no sense here.
      // oxlint-disable-next-line no-await-in-loop
      const line = await prompter.question(marker);
      if (line === null) {
        // Ctrl-C / Ctrl-D / closed stream → leave.
        break;
      }

      const input = line.trim();
      if (EXIT_COMMANDS.has(input)) {
        break;
      }

      // A bare Enter just reprompts; `/help` prints help; anything else goes to
      // the agent. Empty input falls through all branches to a no-op reprompt.
      if (input === '/help') {
        ctx.stdout(renderReplHelp(ctx.palette));
      } else if (input.length > 0) {
        // oxlint-disable-next-line no-await-in-loop -- sequential by nature, see above
        await dispatchMessage(ctx, session, input);
      }
    }
  } finally {
    prompter.close();
  }

  ctx.stdout(renderGoodbye(ctx.palette));
}

/**
 * Send one message to the agent from within the REPL, keeping the loop alive on
 * expected failures. A not-yet-implemented runtime surfaces as a dim inline
 * notice; any other error propagates to the top-level runner.
 */
async function dispatchMessage(ctx: CliContext, session: Session, message: string): Promise<void> {
  try {
    const reply = await ctx.run({ kind: 'sendMessage', message, session });
    ctx.stdout(reply);
  } catch (error: unknown) {
    if (error instanceof NotImplementedError) {
      ctx.stderr(ctx.palette.yellow(`  (${error.message})`));
      return;
    }
    throw error;
  }
}

export { runRoot };
