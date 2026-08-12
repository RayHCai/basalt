import { describe, expect, it } from 'vitest';

import type { Conversation } from './conversation.js';
import { appendTurn, dropOldestTurn, EMPTY_CONVERSATION } from './conversation.js';

describe('conversation', () => {
  it('starts empty', () => {
    expect(EMPTY_CONVERSATION).toEqual([]);
  });

  it('appends a turn without mutating the input', () => {
    const first = appendTurn(EMPTY_CONVERSATION, { message: 'hi', response: 'hello' });
    const second = appendTurn(first, { message: 'bye', response: 'goodbye' });

    expect(first).toEqual([{ message: 'hi', response: 'hello' }]);
    expect(second).toEqual([
      { message: 'hi', response: 'hello' },
      { message: 'bye', response: 'goodbye' },
    ]);
    // The earlier state is untouched.
    expect(first).toHaveLength(1);
  });

  it('drops the oldest turn from the front', () => {
    const conversation: Conversation = [
      { message: '1', response: 'a' },
      { message: '2', response: 'b' },
      { message: '3', response: 'c' },
    ];
    expect(dropOldestTurn(conversation)).toEqual([
      { message: '2', response: 'b' },
      { message: '3', response: 'c' },
    ]);
  });

  it('drops from an empty conversation as a no-op', () => {
    expect(dropOldestTurn(EMPTY_CONVERSATION)).toEqual([]);
  });
});
