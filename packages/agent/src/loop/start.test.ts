import { describe, expect, it, vi } from 'vitest';

import { InMemoryConversationStore } from '../memory/index.js';

import { DEFAULT_SESSION } from './session.js';
import { start } from './start.js';
import type { GetResponse } from './start.js';

describe('start', () => {
  it('routes an assembled prompt to the session provider (API auth) and returns its response', async () => {
    const getResponse = vi.fn<GetResponse>().mockResolvedValue('test');
    const result = await start(DEFAULT_SESSION, 'hello', {
      getResponse,
      store: new InMemoryConversationStore(),
    });

    expect(result).toBe('test');
    expect(getResponse).toHaveBeenCalledOnce();
    const [provider, model, input, type] = getResponse.mock.calls[0] ?? [];
    expect(provider).toBe(DEFAULT_SESSION.provider);
    expect(model).toBe(DEFAULT_SESSION.model);
    expect(type).toBe('API');
    // The message is embedded in the assembled prompt, not sent verbatim.
    expect(input).toContain('hello');
  });

  it('includes the message and system preamble in the prompt', async () => {
    const getResponse = vi.fn<GetResponse>().mockResolvedValue('ok');
    await start(DEFAULT_SESSION, 'what is 2+2?', {
      getResponse,
      system: 'You are a calculator.',
      store: new InMemoryConversationStore(),
    });

    const input = getResponse.mock.calls[0]?.[2] ?? '';
    expect(input).toContain('You are a calculator.');
    expect(input).toContain('User: what is 2+2?');
    expect(input.endsWith('Assistant:')).toBe(true);
  });

  it('carries prior turns forward as context on the next turn', async () => {
    const getResponse = vi
      .fn<GetResponse>()
      .mockResolvedValueOnce('4')
      .mockResolvedValueOnce('yes');
    const store = new InMemoryConversationStore();

    await start(DEFAULT_SESSION, 'what is 2+2?', { getResponse, store });
    await start(DEFAULT_SESSION, 'are you sure?', { getResponse, store });

    const secondPrompt = getResponse.mock.calls[1]?.[2] ?? '';
    expect(secondPrompt).toContain('User: what is 2+2?');
    expect(secondPrompt).toContain('Assistant: 4');
    expect(secondPrompt).toContain('User: are you sure?');
  });

  it('records the exchange in the store', async () => {
    const getResponse = vi.fn<GetResponse>().mockResolvedValue('reply');
    const store = new InMemoryConversationStore();

    await start(DEFAULT_SESSION, 'question', { getResponse, store });

    const conversation = await store.load(DEFAULT_SESSION.id);
    expect(conversation).toEqual([{ message: 'question', response: 'reply' }]);
  });

  it('isolates history by session id', async () => {
    const getResponse = vi.fn<GetResponse>().mockResolvedValue('r');
    const store = new InMemoryConversationStore();

    await start({ ...DEFAULT_SESSION, id: 'a' }, 'from a', { getResponse, store });
    await start({ ...DEFAULT_SESSION, id: 'b' }, 'from b', { getResponse, store });

    const promptForB = getResponse.mock.calls[1]?.[2] ?? '';
    expect(promptForB).not.toContain('from a');
    expect(await store.load('a')).toHaveLength(1);
    expect(await store.load('b')).toHaveLength(1);
  });

  it('does not record a turn when the provider fails', async () => {
    const getResponse = vi.fn<GetResponse>().mockRejectedValue(new Error('provider down'));
    const store = new InMemoryConversationStore();

    await expect(start(DEFAULT_SESSION, 'hi', { getResponse, store })).rejects.toThrow(
      'provider down',
    );
    expect(await store.load(DEFAULT_SESSION.id)).toHaveLength(0);
  });

  it('defaults to the anthropic provider on claude-haiku-4-5 over the API path', async () => {
    // The bring-up default exercises the API path against the cheapest current
    // model; guard both so a repoint or an auth-type change is caught here.
    const getResponse = vi.fn<GetResponse>().mockResolvedValue('hi');
    await start(DEFAULT_SESSION, 'ping', { getResponse, store: new InMemoryConversationStore() });

    expect(DEFAULT_SESSION.provider).toBe('anthropic');
    expect(DEFAULT_SESSION.model).toBe('claude-haiku-4-5');
    const [provider, model, , type] = getResponse.mock.calls[0] ?? [];
    expect(provider).toBe('anthropic');
    expect(model).toBe('claude-haiku-4-5');
    expect(type).toBe('API');
  });
});
