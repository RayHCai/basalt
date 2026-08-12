import { createInterface } from 'node:readline';
import type { Interface as ReadlineInterface } from 'node:readline';

/**
 * A line-oriented input source for the interactive REPL.
 *
 * Abstracted behind an interface so the REPL can be driven by a real terminal
 * in production and by scripted input in tests — no TTY required. This mirrors
 * how the CLI injects `run`: the seam is the interface, the process-backed
 * implementation is just the default.
 */
interface Prompter {
  /**
   * Show `label` and resolve with the next line the user enters (without its
   * trailing newline). Resolves to `null` on end-of-input — Ctrl-D, Ctrl-C, or
   * a closed stream — which the REPL treats as "quit".
   */
  question: (label: string) => Promise<string | null>;
  /** Tear down the underlying resources (readline handle, stdin listeners). */
  close: () => void;
}

/**
 * Builds a fresh {@link Prompter}. Lazy by design: it is only invoked when the
 * REPL actually starts, so non-interactive commands never attach stdin
 * listeners or hold the event loop open.
 */
type OpenPrompter = () => Prompter;

/**
 * The default, process-backed {@link Prompter}: a Node `readline` interface over
 * stdin/stdout. Ctrl-C (SIGINT) is treated as a request to leave — it closes the
 * interface, which surfaces to the REPL as end-of-input.
 *
 * Lines are consumed through a persistent `line` listener that feeds a small
 * queue, rather than a fresh `rl.question` per turn. This matters when input
 * arrives faster than the loop asks for it (piped stdin, tests): readline emits
 * `line` events eagerly, and a one-shot-per-turn listener would drop any line
 * that lands between turns. The queue captures every line and hands them out in
 * order.
 */
function openNodePrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return makeReadlinePrompter(rl, (text) => process.stdout.write(text));
}

/**
 * Wire a {@link Prompter} over an existing readline interface. Split out from
 * {@link openNodePrompter} so the buffering logic is unit-testable with a fake
 * interface and an arbitrary output sink.
 */
function makeReadlinePrompter(rl: ReadlineInterface, write: (text: string) => void): Prompter {
  /** Lines received but not yet requested by the REPL. */
  const pending: string[] = [];
  /** A waiter parked in `question()` when no line is buffered yet. */
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;

  const deliver = (line: string | null): void => {
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else if (line !== null) {
      pending.push(line);
    }
  };

  rl.on('line', (line: string) => {
    deliver(line);
  });
  // Ctrl-C and end-of-input both close the interface; the REPL reads that as
  // "quit". Wake any parked waiter with null.
  rl.on('SIGINT', () => {
    rl.close();
  });
  rl.on('close', () => {
    closed = true;
    deliver(null);
  });

  return {
    question: (label: string): Promise<string | null> => {
      const buffered = pending.shift();
      if (buffered !== undefined) {
        return Promise.resolve(buffered);
      }
      if (closed) {
        return Promise.resolve(null);
      }
      write(label);
      // Promisify the "wait for the next line" step: the resolver is parked in
      // `waiting` and fired by the `line`/`close` handlers above.
      // oxlint-disable-next-line promise/avoid-new
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    close: (): void => {
      rl.close();
    },
  };
}

export { makeReadlinePrompter, type OpenPrompter, openNodePrompter, type Prompter };
