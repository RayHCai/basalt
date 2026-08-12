import { describe, expect, it } from 'vitest';

import type { Conversation } from '../context/index.js';

import { buildPrompt } from './prompt.js';

describe('buildPrompt', () => {
  it('renders system, new message, and a trailing assistant cue with no history', () => {
    const prompt = buildPrompt('SYSTEM', [], 'hello');
    expect(prompt).toBe('SYSTEM\n\nUser: hello\nAssistant:');
  });

  it('renders prior turns before the new message', () => {
    const conversation: Conversation = [
      { message: 'q1', response: 'a1' },
      { message: 'q2', response: 'a2' },
    ];
    const prompt = buildPrompt('S', conversation, 'q3');
    expect(prompt).toBe(
      'S\n\nUser: q1\nAssistant: a1\nUser: q2\nAssistant: a2\nUser: q3\nAssistant:',
    );
  });

  it('ends with a bare assistant cue for the model to complete', () => {
    expect(buildPrompt('S', [], 'x').endsWith('Assistant:')).toBe(true);
  });
});
