import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createSecretValueReader } from './secret-input.js';
import type { SecretInputStream } from './secret-input.js';

/** A non-TTY readable over `chunks`, satisfying the reader's stream shape. */
function pipedStream(...chunks: string[]): SecretInputStream {
  const stream = Readable.from(chunks) as unknown as SecretInputStream;
  return stream;
}

/** A capturing writable for the prompt sink. */
function captureOut(): { stream: NodeJS.WritableStream; written: string[] } {
  const written: string[] = [];
  const stream = {
    write: (text: string): boolean => {
      written.push(text);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, written };
}

describe('createSecretValueReader — piped (non-TTY) stdin', () => {
  it('reads the whole stream as the value', async () => {
    const read = createSecretValueReader({
      input: pipedStream('sk-ant-'),
      promptOut: captureOut().stream,
    });
    await expect(read('Value: ')).resolves.toBe('sk-ant-');
  });

  it('trims exactly one trailing newline (echo / editor / < file)', async () => {
    const read = createSecretValueReader({ input: pipedStream('token-value\n') });
    await expect(read('Value: ')).resolves.toBe('token-value');
  });

  it('trims a trailing CRLF', async () => {
    const read = createSecretValueReader({ input: pipedStream('token-value\r\n') });
    await expect(read('Value: ')).resolves.toBe('token-value');
  });

  it('keeps interior newlines and only strips the final one', async () => {
    const read = createSecretValueReader({ input: pipedStream('line1\nline2\n') });
    await expect(read('Value: ')).resolves.toBe('line1\nline2');
  });

  it('concatenates multiple chunks', async () => {
    const read = createSecretValueReader({ input: pipedStream('abc', 'def', 'ghi') });
    await expect(read('Value: ')).resolves.toBe('abcdefghi');
  });

  it('returns empty string for empty stdin (caller treats as error)', async () => {
    const read = createSecretValueReader({ input: pipedStream() });
    await expect(read('Value: ')).resolves.toBe('');
  });

  it('does not write a prompt on the non-TTY path', async () => {
    const { stream, written } = captureOut();
    const read = createSecretValueReader({ input: pipedStream('x'), promptOut: stream });
    await read('Value: ');
    expect(written).toEqual([]);
  });
});

/**
 * A fake raw-mode TTY: a PassThrough marked `isTTY` with `setRawMode` calls
 * recorded. The reader accumulates `data` chunks itself, so the test drives
 * input by writing keystrokes and terminates the line with a CR.
 */
function ttyStream(): {
  stream: SecretInputStream;
  type: (keys: string) => void;
  rawModes: boolean[];
} {
  const pt = new PassThrough();
  const rawModes: boolean[] = [];
  Object.defineProperty(pt, 'isTTY', { value: true });
  (pt as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (mode: boolean) => {
    rawModes.push(mode);
  };
  const stream = pt as unknown as SecretInputStream;
  return { stream, type: (keys: string) => pt.write(keys), rawModes };
}

/** DEL byte (Backspace) as a Unicode escape, to keep the source printable. */
const DEL = '\u007F';
/** ETX byte (Ctrl-C) as a Unicode escape. */
const CTRL_C = '\u0003';

describe('createSecretValueReader — interactive (TTY) stdin', () => {
  it('reads a hidden line terminated by Enter, enabling then restoring raw mode', async () => {
    const { stream, type, rawModes } = ttyStream();
    const { stream: out, written } = captureOut();
    const read = createSecretValueReader({ input: stream, promptOut: out });

    const pending = read('Value: ');
    type('typed-secret\r');
    await expect(pending).resolves.toBe('typed-secret');

    // Prompt shown on the prompt sink; raw mode on for the read, off after.
    expect(written.join('')).toContain('Value: ');
    expect(rawModes).toEqual([true, false]);
  });

  it('applies Backspace without echo', async () => {
    const { stream, type } = ttyStream();
    const read = createSecretValueReader({ input: stream, promptOut: captureOut().stream });

    const pending = read('Value: ');
    // type "abcX", then Backspace (DEL)
    type(`abcX${DEL}`);
    type('\r');
    await expect(pending).resolves.toBe('abc');
  });

  it('treats Ctrl-C as an empty result', async () => {
    const { stream, type } = ttyStream();
    const read = createSecretValueReader({ input: stream, promptOut: captureOut().stream });

    const pending = read('Value: ');
    // Ctrl-C mid-entry
    type(`partial${CTRL_C}`);
    await expect(pending).resolves.toBe('');
  });
});
