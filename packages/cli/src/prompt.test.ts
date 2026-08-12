import { EventEmitter } from 'node:events';
import type { Interface as ReadlineInterface } from 'node:readline';

import { describe, expect, it } from 'vitest';

import { makeReadlinePrompter } from './prompt.js';

/**
 * A minimal readline stand-in: an EventEmitter that records `close()`. Enough to
 * exercise the prompter's buffering without a real terminal. (readline itself is
 * an EventEmitter, so this matches the real type.)
 */
function fakeReadline(): ReadlineInterface & { emitLine: (line: string) => void; ended: boolean } {
  // oxlint-disable-next-line unicorn/prefer-event-target -- mirrors readline's EventEmitter API
  const emitter = new EventEmitter() as EventEmitter & {
    close: () => void;
    ended: boolean;
    emitLine: (line: string) => void;
  };
  emitter.ended = false;
  emitter.close = (): void => {
    emitter.ended = true;
    emitter.emit('close');
  };
  emitter.emitLine = (line: string): void => {
    emitter.emit('line', line);
  };
  return emitter as unknown as ReadlineInterface & {
    emitLine: (line: string) => void;
    ended: boolean;
  };
}

describe('makeReadlinePrompter', () => {
  it('resolves a pending question when a line arrives later', async () => {
    const rl = fakeReadline();
    const prompter = makeReadlinePrompter(rl, () => {});
    const answer = prompter.question('▶ ');
    rl.emitLine('hello');
    expect(await answer).toBe('hello');
  });

  it('buffers lines that arrive before they are requested (fast/piped input)', async () => {
    const rl = fakeReadline();
    const prompter = makeReadlinePrompter(rl, () => {});
    // All input lands up front, as with piped stdin.
    rl.emitLine('one');
    rl.emitLine('two');
    expect(await prompter.question('▶ ')).toBe('one');
    expect(await prompter.question('▶ ')).toBe('two');
  });

  it('prints the label only when it actually has to wait', async () => {
    const rl = fakeReadline();
    const writes: string[] = [];
    const prompter = makeReadlinePrompter(rl, (text) => writes.push(text));
    rl.emitLine('buffered');
    // Served from the buffer, so no prompt is written.
    await prompter.question('▶ ');
    // Nothing buffered now, so this one prompts.
    const waiting = prompter.question('▶ ');
    expect(writes).toEqual(['▶ ']);
    rl.emitLine('later');
    await waiting;
  });

  it('resolves null on close (end-of-input)', async () => {
    const rl = fakeReadline();
    const prompter = makeReadlinePrompter(rl, () => {});
    const answer = prompter.question('▶ ');
    rl.close();
    expect(await answer).toBeNull();
  });

  it('resolves null immediately once closed', async () => {
    const rl = fakeReadline();
    const prompter = makeReadlinePrompter(rl, () => {});
    rl.close();
    expect(await prompter.question('▶ ')).toBeNull();
  });

  it('close() tears down the underlying interface', () => {
    const rl = fakeReadline();
    const prompter = makeReadlinePrompter(rl, () => {});
    prompter.close();
    expect(rl.ended).toBe(true);
  });
});
