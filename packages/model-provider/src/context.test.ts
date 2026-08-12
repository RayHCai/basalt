import { Secret } from '@basalt/secrets';
import { describe, expect, it } from 'vitest';

import { createProviderContext } from './context.js';
import type { ProviderCredentials } from './credentials.js';

const apiOnly: ProviderCredentials = { api: { apiKey: new Secret('k') } };

describe('createProviderContext', () => {
  it('carries name and credentials through', () => {
    const context = createProviderContext({ name: 'anthropic', credentials: apiOnly });
    expect(context.name).toBe('anthropic');
    expect(context.credentials).toBe(apiOnly);
  });

  it('defaults headers and models to empty and omits baseUrl when not given', () => {
    const context = createProviderContext({ name: 'x', credentials: {} });
    expect(context.defaultHeaders).toEqual({});
    expect(context.models).toEqual([]);
    expect(context.baseUrl).toBeUndefined();
    expect('baseUrl' in context).toBe(false);
  });

  it('carries provided models through', () => {
    const models = [{ name: 'claude-opus-4-8', enabled: true }];
    const context = createProviderContext({ name: 'x', credentials: {}, models });
    expect(context.models).toBe(models);
  });

  it('keeps a provided baseUrl and headers', () => {
    const context = createProviderContext({
      name: 'x',
      credentials: {},
      baseUrl: 'https://api.example.com',
      defaultHeaders: { 'x-app': 'basalt' },
    });
    expect(context.baseUrl).toBe('https://api.example.com');
    expect(context.defaultHeaders).toEqual({ 'x-app': 'basalt' });
  });

  it('builds a logger tagged for the provider when none is injected', () => {
    const context = createProviderContext({ name: 'x', credentials: {} });
    expect(typeof context.logger.info).toBe('function');
  });

  it('uses an injected logger as-is', () => {
    const fake = { info: (): void => {} } as unknown as ReturnType<
      typeof createProviderContext
    >['logger'];
    const context = createProviderContext({ name: 'x', credentials: {}, logger: fake });
    expect(context.logger).toBe(fake);
  });
});
