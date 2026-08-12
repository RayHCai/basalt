import type { Palette } from './colors.js';

/**
 * A tiny terminal spinner for long-running commands (e.g. `basalt evaluate
 * load`, which clones RULER, sets up Python, downloads corpora, and generates
 * data — minutes of work).
 *
 * Design mirrors the rest of the CLI's testability seams: the timer and the
 * output stream are injected, so a test drives frames with a fake scheduler and
 * captures output without a real TTY. On a non-TTY stream (pipe, CI, test) the
 * spinner degrades to plain one-line status updates — no cursor tricks — so logs
 * stay clean.
 */

/** The braille frames cycled while active (Claude-Code style). */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** How often (ms) the spinner advances a frame. */
const FRAME_INTERVAL_MS = 80;

/** An injectable interval scheduler (defaults to Node's `setInterval`). */
interface Scheduler {
  set: (callback: () => void, ms: number) => NodeJS.Timeout;
  clear: (handle: NodeJS.Timeout) => void;
}

/** The default scheduler backed by the global timers. */
const defaultScheduler: Scheduler = {
  set: (callback, ms) => setInterval(callback, ms),
  clear: (handle) => {
    clearInterval(handle);
  },
};

/** Options for {@link createSpinner}. */
interface SpinnerOptions {
  /** Stream to draw on. Defaults to `process.stderr` (keeps stdout for results). */
  stream?: NodeJS.WriteStream;
  /** Palette for styling the frame/label. Defaults to no styling. */
  palette?: Palette;
  /** Whether the target is a TTY (animate) vs. plain (status lines). Defaults to the stream's `isTTY`. */
  isTty?: boolean;
  /** Interval scheduler. Injected for deterministic tests. */
  scheduler?: Scheduler;
}

/** A running spinner handle. */
interface Spinner {
  /** Start animating with an initial `label`. Idempotent (a second call is ignored). */
  start: (label: string) => void;
  /** Update the label shown next to the spinner (or as the next status line). */
  update: (label: string) => void;
  /** Stop and clear the animation, optionally printing a final `done` line. */
  stop: (done?: string) => void;
}

/** The identity styler used when no palette is supplied. */
const NO_STYLE = (text: string): string => text;

/**
 * Build a spinner. Nothing is drawn until {@link Spinner.start}. On a TTY it
 * redraws a single line in place (carriage return + clear); otherwise it emits a
 * plain status line on start, on each distinct label, and on stop.
 */
function createSpinner(options: SpinnerOptions = {}): Spinner {
  const stream = options.stream ?? process.stderr;
  const { palette } = options;
  const isTty = options.isTty ?? Boolean(stream.isTTY);
  const scheduler = options.scheduler ?? defaultScheduler;
  const accent = palette?.accent ?? NO_STYLE;
  const dim = palette?.dim ?? NO_STYLE;

  // oxlint-disable-next-line init-declarations
  let handle: NodeJS.Timeout | undefined;
  let frame = 0;
  let label = '';

  /** Redraw the current frame + label in place (TTY only). */
  const render = (): void => {
    const glyph = FRAMES[frame % FRAMES.length] ?? FRAMES[0];
    frame += 1;
    // \r returns to column 0; [K clears to end of line so shorter labels
    // don't leave stale characters behind.
    stream.write(`\r[K${accent(glyph)} ${label}`);
  };

  const start = (initialLabel: string): void => {
    if (handle !== undefined || (!isTty && label !== '')) {
      return;
    }
    label = initialLabel;
    if (isTty) {
      render();
      handle = scheduler.set(render, FRAME_INTERVAL_MS);
    } else {
      stream.write(`${label}\n`);
    }
  };

  const update = (next: string): void => {
    if (next === label) {
      return;
    }
    label = next;
    // On a non-TTY, print each new status as its own line; on a TTY the running
    // interval picks up the new label on its next tick.
    if (!isTty) {
      stream.write(`${label}\n`);
    }
  };

  const stop = (done?: string): void => {
    if (handle !== undefined) {
      scheduler.clear(handle);
      handle = undefined;
    }
    if (isTty) {
      // Clear the spinner line before any final message.
      stream.write('\r[K');
    }
    if (done !== undefined) {
      stream.write(`${dim(done)}\n`);
    }
  };

  return { start, update, stop };
}

export { createSpinner, type Scheduler };
