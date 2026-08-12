import type { ConfigStore } from '@basalt/config';
import { Secret } from '@basalt/secrets';
import { describe, expect, it } from 'vitest';

import { ModelProviderError } from './errors.js';
import { contextFromConfig, credentialsFromConfig, modelsFromConfig } from './from-config.js';
import type { ResolvedModelProviderConfig } from './from-config.js';

/** Build a resolved model-provider config for a given auth/harness shape. */
function cfg(
  parts: Partial<Pick<ResolvedModelProviderConfig, 'auth' | 'harness' | 'models'>> = {},
): ResolvedModelProviderConfig {
  return {
    enabled: true,
    auth: parts.auth ?? {},
    defaultHeaders: {},
    models: parts.models ?? [],
    ...(parts.harness === undefined ? {} : { harness: parts.harness }),
  } as ResolvedModelProviderConfig;
}

/** A ConfigStore stub whose `modelProvider(name)` returns `config` for `name`. */
function fakeStore(name: string, config?: ResolvedModelProviderConfig): ConfigStore {
  return {
    modelProvider: (n: string) => (n === name ? config : undefined),
  } as unknown as ConfigStore;
}

describe('credentialsFromConfig', () => {
  it('maps an empty auth bag to an empty credentials bag', () => {
    expect(credentialsFromConfig(cfg({ auth: {} }))).toEqual({});
  });

  it('maps apiKey auth to api credentials', () => {
    const creds = credentialsFromConfig(cfg({ auth: { apiKey: new Secret('sk') } }));
    expect(creds.api?.apiKey.expose()).toBe('sk');
    expect(creds.oauth).toBeUndefined();
    expect(creds.harness).toBeUndefined();
  });

  it('maps oauth auth, including optional refreshToken when present', () => {
    const creds = credentialsFromConfig(
      cfg({
        auth: {
          oauth: {
            clientId: 'cid',
            clientSecret: new Secret('cs'),
            tokenUrl: 'https://auth/token',
            refreshToken: new Secret('rt'),
            scopes: ['read', 'write'],
          },
        },
      }),
    );
    expect(creds.oauth?.clientId).toBe('cid');
    expect(creds.oauth?.clientSecret?.expose()).toBe('cs');
    expect(creds.oauth?.tokenUrl).toBe('https://auth/token');
    expect(creds.oauth?.refreshToken?.expose()).toBe('rt');
    expect(creds.oauth?.scopes).toEqual(['read', 'write']);
  });

  it('maps a public-client oauth (no clientSecret), omitting it from the bag', () => {
    const creds = credentialsFromConfig(
      cfg({
        auth: {
          oauth: {
            clientId: 'cid',
            tokenUrl: 'https://auth/token',
            refreshToken: new Secret('rt'),
            scopes: ['user:inference'],
          },
        },
      }),
    );
    expect(creds.oauth?.clientId).toBe('cid');
    expect(creds.oauth?.refreshToken?.expose()).toBe('rt');
    expect(creds.oauth?.clientSecret).toBeUndefined();
    expect(creds.oauth && 'clientSecret' in creds.oauth).toBe(false);
  });

  it('omits refreshToken when absent', () => {
    const creds = credentialsFromConfig(
      cfg({
        auth: {
          oauth: {
            clientId: 'cid',
            clientSecret: new Secret('cs'),
            tokenUrl: 'https://auth/token',
            scopes: [],
          },
        },
      }),
    );
    expect(creds.oauth?.refreshToken).toBeUndefined();
    expect(creds.oauth && 'refreshToken' in creds.oauth).toBe(false);
  });

  it('maps a top-level harness to harness credentials', () => {
    const creds = credentialsFromConfig(
      cfg({ harness: { command: 'codex', args: ['--yolo'], env: { KEY: new Secret('v') } } }),
    );
    expect(creds.harness?.command).toBe('codex');
    expect(creds.harness?.args).toEqual(['--yolo']);
    expect(creds.harness?.env['KEY']?.expose()).toBe('v');
  });

  it('carries multiple methods at once (apiKey + oauth + harness)', () => {
    const creds = credentialsFromConfig(
      cfg({
        auth: {
          apiKey: new Secret('sk'),
          oauth: {
            clientId: 'cid',
            clientSecret: new Secret('cs'),
            tokenUrl: 'https://auth/token',
            scopes: [],
          },
        },
        harness: { command: 'claude', args: [], env: {} },
      }),
    );
    expect(creds.api?.apiKey.expose()).toBe('sk');
    expect(creds.oauth?.clientId).toBe('cid');
    expect(creds.harness?.command).toBe('claude');
  });
});

describe('modelsFromConfig', () => {
  it('maps an empty models list to an empty array', () => {
    expect(modelsFromConfig(cfg())).toEqual([]);
  });

  it('carries each model name and enabled flag through', () => {
    const models = modelsFromConfig(
      cfg({
        models: [
          { name: 'claude-opus-4-8', enabled: true },
          { name: 'claude-haiku-4-5', enabled: false },
        ],
      }),
    );
    expect(models).toEqual([
      { name: 'claude-opus-4-8', enabled: true },
      { name: 'claude-haiku-4-5', enabled: false },
    ]);
  });
});

describe('contextFromConfig', () => {
  it('builds a context from a store entry', () => {
    const config = {
      enabled: true,
      auth: { apiKey: new Secret('sk') },
      defaultHeaders: { 'x-app': 'basalt' },
      models: [{ name: 'claude-opus-4-8', enabled: true }],
      baseUrl: 'https://api.example.com',
    } as unknown as ResolvedModelProviderConfig;
    const context = contextFromConfig(fakeStore('anthropic', config), 'anthropic');
    expect(context.name).toBe('anthropic');
    expect(context.baseUrl).toBe('https://api.example.com');
    expect(context.defaultHeaders).toEqual({ 'x-app': 'basalt' });
    expect(context.credentials.api?.apiKey.expose()).toBe('sk');
    expect(context.models).toEqual([{ name: 'claude-opus-4-8', enabled: true }]);
  });

  it('omits baseUrl when the config has none', () => {
    const context = contextFromConfig(fakeStore('x', cfg()), 'x');
    expect('baseUrl' in context).toBe(false);
  });

  it('throws ModelProviderError for an unknown provider', () => {
    expect(() => contextFromConfig(fakeStore('x'), 'missing')).toThrow(ModelProviderError);
  });
});
