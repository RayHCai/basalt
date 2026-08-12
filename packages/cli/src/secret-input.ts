/**
 * Read a secret VALUE from a safe source — never from argv. Two sources, chosen
 * by whether stdin is a terminal:
 *
 *  - **Non-TTY stdin (piped/redirected):** read stdin to end and use it verbatim
 *    (a single trailing newline trimmed, so `... < file` and `echo x | ...` both
 *    work). This is the scriptable path.
 *  - **TTY stdin (interactive):** prompt on stderr and read one line in RAW mode,
 *    accumulating bytes ourselves and echoing NOTHING, so the secret is never
 *    shown on screen or left in the terminal scrollback. (We deliberately don't
 *    use `readline` here: in terminal mode it echoes typed input to its output —
 *    the opposite of what a secret prompt needs.)
 *
 * Returns the raw value (possibly empty — the caller decides whether an empty
 * value is an error). The value is handled as a plain string only long enough to
 * hand to the sealing layer; it is never logged.
 *
 * Split behind {@link ReadSecretValue} so command handlers depend on the seam,
 * not on `process.stdin` directly — tests inject a scripted reader.
 */
type ReadSecretValue = (prompt: string) => Promise<string>;

/** ASCII control bytes the raw-mode line reader recognizes. */
const CR = '\r';
const LF = '\n';
/** Ctrl-C (End of Text) — abandon input. */
const ETX = '\u0003';
/** Ctrl-D (End of Transmission) — end the line. */
const EOT = '\u0004';
/** DEL and BS — both sent by the Backspace key across terminals. */
const BACKSPACE = new Set(['\u007F', '\b']);

/** A minimal view of the stdin stream this reader needs. Eases testing. */
interface SecretInputStream extends NodeJS.ReadableStream {
  readonly isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
}

/** Options for {@link createSecretValueReader} (all injectable for tests). */
interface SecretValueReaderOptions {
  /** Input stream. Defaults to `process.stdin`. */
  input?: SecretInputStream;
  /** Where the interactive prompt label is written. Defaults to `process.stderr`. */
  promptOut?: NodeJS.WritableStream;
}

/** Read all of a non-TTY stdin as UTF-8, trimming a single trailing newline. */
async function readPipedInput(input: SecretInputStream): Promise<string> {
  input.setEncoding('utf8');
  let data = '';
  for await (const chunk of input) {
    data += chunk;
  }
  // A piped value usually ends in one newline (`echo`, editors, `< file`); drop
  // exactly one trailing \n or \r\n so it doesn't become part of the secret.
  return data.replace(/\r?\n$/u, '');
}

/**
 * Prompt on `promptOut` and read one line from a TTY `input` in raw mode,
 * echoing nothing. Accumulates bytes until Enter (CR/LF); handles Backspace
 * (edit without echo) and treats Ctrl-C / Ctrl-D as end-of-input. Raw mode is
 * enabled for the read and always restored in a `finally`-style cleanup so the
 * terminal is never left raw.
 */
function readHiddenLine(
  input: SecretInputStream,
  promptOut: NodeJS.WritableStream,
  prompt: string,
): Promise<string> {
  promptOut.write(prompt);
  input.setRawMode?.(true);
  input.setEncoding('utf8');
  input.resume?.();

  // oxlint-disable-next-line promise/avoid-new -- adapting the stream's data/end events to a promise
  return new Promise<string>((resolve) => {
    let value = '';
    let settled = false;

    const cleanup = (): void => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.setRawMode?.(false);
      input.pause?.();
      // The typed newline was swallowed; emit one so later output starts fresh.
      promptOut.write('\n');
    };
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    function onData(chunk: string): void {
      for (const ch of chunk) {
        if (ch === CR || ch === LF || ch === EOT) {
          finish();
          return;
        }
        if (ch === ETX) {
          // Ctrl-C: abandon input, return what we have (empty by convention).
          value = '';
          finish();
          return;
        }
        value = BACKSPACE.has(ch) ? value.slice(0, -1) : value + ch;
      }
    }
    function onEnd(): void {
      finish();
    }

    input.on('data', onData);
    input.on('end', onEnd);
  });
}

/**
 * Build the default, process-backed secret-value reader. Chooses the piped or
 * interactive path from `input.isTTY`.
 */
function createSecretValueReader(options: SecretValueReaderOptions = {}): ReadSecretValue {
  const input = options.input ?? process.stdin;
  const promptOut = options.promptOut ?? process.stderr;
  return (prompt: string): Promise<string> =>
    input.isTTY === true ? readHiddenLine(input, promptOut, prompt) : readPipedInput(input);
}

export {
  createSecretValueReader,
  type ReadSecretValue,
  type SecretInputStream,
  type SecretValueReaderOptions,
};
