import { describe, expect, it } from 'vitest';

import type { Conversation } from '../context/index.js';

import { estimateTokens, fitToBudget } from './fit.js';

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 characters, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('fitToBudget', () => {
  const longConversation: Conversation = Array.from({ length: 10 }, (_, i) => ({
    message: `question number ${i} with some length to it`,
    response: `answer number ${i} with some length to it`,
  }));

  it('keeps all turns when the prompt already fits', () => {
    const result = fitToBudget('S', longConversation, 'new message', 100_000);
    expect(result.dropped).toBe(0);
    expect(result.conversation).toHaveLength(longConversation.length);
    expect(result.prompt).toContain('new message');
  });

  it('drops the oldest turns until the prompt fits', () => {
    const result = fitToBudget('S', longConversation, 'new message', 60);
    expect(result.dropped).toBeGreaterThan(0);
    expect(estimateTokens(result.prompt)).toBeLessThanOrEqual(60);
    // Trimming is from the top: the most recent turn survives.
    expect(result.prompt).toContain('question number 9');
    expect(result.prompt).not.toContain('question number 0');
  });

  it('never drops the system preamble or the new message, even under budget', () => {
    // A budget too small for even the floor prompt: history empties out but the
    // question is preserved.
    const result = fitToBudget('SYSTEM', longConversation, 'the actual question', 1);
    expect(result.conversation).toHaveLength(0);
    expect(result.dropped).toBe(longConversation.length);
    expect(result.prompt).toContain('SYSTEM');
    expect(result.prompt).toContain('the actual question');
  });
});
