import { describe, expect, it } from 'vitest';

import { createSpinner } from './spinner.js';
import type { Scheduler } from './spinner.js';

/** A capturing stream double with a controllable `isTTY`. */
function fakeStream(isTty: boolean): { stream: NodeJS.WriteStream; writes: string[] } {
  const writes: string[] = [];
  const stream = {
    isTTY: isTty,
    write: (chunk: string): boolean => {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}

/** A scheduler whose tick can be fired manually. */
function manualScheduler(): { scheduler: Scheduler; tick: () => void; cleared: boolean } {
  const state = { callback: undefined as (() => void) | undefined, cleared: false };
  const scheduler: Scheduler = {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Scheduler's contract IS a callback (setInterval-shaped)
    set: (callback) => {
      state.callback = callback;
      return 0 as unknown as NodeJS.Timeout;
    },
    clear: () => {
      state.cleared = true;
    },
  };
  return {
    scheduler,
    tick: () => state.callback?.(),
    get cleared(): boolean {
      return state.cleared;
    },
  };
}

describe('createSpinner (TTY)', () => {
  it('draws an initial frame on start and redraws on tick', () => {
    const { stream, writes } = fakeStream(true);
    const sched = manualScheduler();
    const spinner = createSpinner({ stream, isTty: true, scheduler: sched.scheduler });

    spinner.start('working');
    expect(writes.join('')).toContain('working');
    const framesBefore = writes.length;
    sched.tick();
    expect(writes.length).toBeGreaterThan(framesBefore);
  });

  it('clears the line and clears the interval on stop', () => {
    const { stream, writes } = fakeStream(true);
    const sched = manualScheduler();
    const spinner = createSpinner({ stream, isTty: true, scheduler: sched.scheduler });

    spinner.start('working');
    spinner.stop('done');
    expect(sched.cleared).toBe(true);
    expect(writes.join('')).toContain('done');
    // A carriage return is used to clear the animated line.
    expect(writes.join('')).toContain('\r');
  });

  it('picks up an updated label on the next tick', () => {
    const { stream, writes } = fakeStream(true);
    const sched = manualScheduler();
    const spinner = createSpinner({ stream, isTty: true, scheduler: sched.scheduler });

    spinner.start('step 1');
    spinner.update('step 2');
    sched.tick();
    expect(writes.join('')).toContain('step 2');
  });
});

describe('createSpinner (non-TTY)', () => {
  it('emits plain status lines, no animation or scheduler use', () => {
    const { stream, writes } = fakeStream(false);
    const sched = manualScheduler();
    const spinner = createSpinner({ stream, isTty: false, scheduler: sched.scheduler });

    spinner.start('step 1');
    spinner.update('step 2');
    // A duplicate label is ignored (no repeated line).
    spinner.update('step 2');
    spinner.stop('done');

    const out = writes.join('');
    expect(out).toContain('step 1\n');
    expect(out).toContain('step 2\n');
    expect(out).toContain('done\n');
    // No carriage-return cursor tricks on a non-TTY.
    expect(out).not.toContain('\r');
  });
});
