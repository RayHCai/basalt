import { describe, expect, it } from 'vitest';

import { InMemoryConversationStore } from './store.js';

describe('InMemoryConversationStore', () => {
  it('returns the empty conversation for an unknown session', async () => {
    const store = new InMemoryConversationStore();
    expect(await store.load('nobody')).toEqual([]);
  });

  it('appends turns and reloads them', async () => {
    const store = new InMemoryConversationStore();
    await store.append('s1', { message: 'q1', response: 'a1' });
    await store.append('s1', { message: 'q2', response: 'a2' });

    expect(await store.load('s1')).toEqual([
      { message: 'q1', response: 'a1' },
      { message: 'q2', response: 'a2' },
    ]);
  });

  it('returns the new conversation state from append', async () => {
    const store = new InMemoryConversationStore();
    const next = await store.append('s1', { message: 'q', response: 'a' });
    expect(next).toEqual([{ message: 'q', response: 'a' }]);
  });

  it('keeps sessions independent', async () => {
    const store = new InMemoryConversationStore();
    await store.append('a', { message: 'from a', response: 'ra' });
    await store.append('b', { message: 'from b', response: 'rb' });

    expect(await store.load('a')).toEqual([{ message: 'from a', response: 'ra' }]);
    expect(await store.load('b')).toEqual([{ message: 'from b', response: 'rb' }]);
  });
});
