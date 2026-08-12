import { isSensitiveKey, Secret, UNTRUSTED_ENV_VAR } from '@basalt/secrets';
import { describe, expect, it } from 'vitest';

import { createProviderContext } from './context.js';
import type { ProviderContext } from './context.js';
import type { ProviderCredentials } from './credentials.js';
import { ProviderNotImplementedError, UnsupportedAuthMethodError } from './errors.js';
import type { ModelInfo } from './models.js';
import { BaseModelProvider } from './provider.js';
import type { CustomHarnessOptions } from './types.js';

/* oxlint-disable max-classes-per-file -- two small test-double providers belong together */

/**
 * A minimal concrete provider exposing the protected helpers so the base-class
 * behavior can be exercised. It echoes which method was selected.
 */
class TestProvider extends BaseModelProvider {
  // oxlint-disable-next-line require-await -- async is part of the contract; this double is sync
  protected override async getAPIResponse(model: string, input: string): Promise<string> {
    return `api:${model}:${this.requireApiCredentials().apiKey.expose()}:${input}`;
  }

  // oxlint-disable-next-line require-await -- async is part of the contract; this double is sync
  protected override async getOAuthResponse(model: string, input: string): Promise<string> {
    const oauth = this.requireOAuthCredentials();
    return `oauth:${model}:${oauth.clientId}:${input}`;
  }

  exposeApi(): Secret {
    return this.requireApiCredentials().apiKey;
  }

  exposeOAuthClientId(): string {
    return this.requireOAuthCredentials().clientId;
  }

  exposeHarnessCommand(): string {
    return this.requireHarnessCredentials().command;
  }

  exposeModels(): readonly ModelInfo[] {
    return this.models();
  }

  exposeActiveModels(): readonly ModelInfo[] {
    return this.activeModels();
  }

  exposeBaseUrl(): string | undefined {
    return this.baseUrl();
  }

  exposeHeaders(): Readonly<Record<string, string>> {
    return this.defaultHeaders();
  }

  exposeHarnessEnv(source: NodeJS.ProcessEnv): Record<string, string> {
    return this.buildHarnessEnv(source);
  }
}

/** A provider that DOES implement the harness path. */
class HarnessProvider extends BaseModelProvider {
  // oxlint-disable-next-line require-await -- test double
  protected override async getAPIResponse(): Promise<string> {
    return 'unused';
  }

  // oxlint-disable-next-line require-await -- test double
  protected override async getOAuthResponse(): Promise<string> {
    return 'unused';
  }

  // oxlint-disable-next-line require-await -- async is part of the contract; this double is sync
  override async getHarnessResponse(
    input: string,
    options?: CustomHarnessOptions,
  ): Promise<string> {
    const { command } = this.requireHarnessCredentials();
    // Echo the public `effort` knob so a test can prove it flows through.
    const effort = options?.effort ?? 'default';
    return `${command}:${effort}:${input}`;
  }
}

const apiCred = { apiKey: new Secret('sk-test') };
const oauthCred = {
  clientId: 'cid',
  clientSecret: new Secret('csecret'),
  tokenUrl: 'https://auth.example.com/token',
  scopes: ['read'],
};
const harnessCred = {
  command: 'claude',
  args: ['--print'],
  env: { PROVIDER_API_KEY: new Secret('harness-key') },
};
const fullCreds: ProviderCredentials = {
  api: apiCred,
  oauth: oauthCred,
  harness: harnessCred,
};

function ctx(credentials: ProviderCredentials, extra?: Partial<ProviderContext>): ProviderContext {
  return createProviderContext({
    name: 'test',
    credentials,
    ...(extra?.models === undefined ? {} : { models: extra.models }),
    ...(extra?.baseUrl === undefined ? {} : { baseUrl: extra.baseUrl }),
    ...(extra?.defaultHeaders === undefined ? {} : { defaultHeaders: extra.defaultHeaders }),
  });
}

describe('BaseModelProvider.getResponse', () => {
  it('uses API credentials for type API', async () => {
    const p = new TestProvider(ctx(fullCreds));
    await expect(p.getResponse('m1', 'hi', 'API')).resolves.toBe('api:m1:sk-test:hi');
  });

  it('uses OAuth credentials for type oAuth', async () => {
    const p = new TestProvider(ctx(fullCreds));
    await expect(p.getResponse('m2', 'yo', 'oAuth')).resolves.toBe('oauth:m2:cid:yo');
  });
});

describe('require* helpers', () => {
  it('throws UnsupportedAuthMethodError with provider + method when API absent', () => {
    const p = new TestProvider(ctx({ oauth: oauthCred }));
    try {
      p.exposeApi();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedAuthMethodError);
      expect((error as UnsupportedAuthMethodError).provider).toBe('test');
      expect((error as UnsupportedAuthMethodError).method).toBe('API');
    }
  });

  it('throws for a missing OAuth method', () => {
    const p = new TestProvider(ctx({ api: apiCred }));
    expect(() => p.exposeOAuthClientId()).toThrow(UnsupportedAuthMethodError);
  });

  it('throws for a missing harness method', () => {
    const p = new TestProvider(ctx({ api: apiCred }));
    expect(() => p.exposeHarnessCommand()).toThrow(/not configured for harness/u);
  });

  it('returns the credential when present', () => {
    const p = new TestProvider(ctx(fullCreds));
    expect(p.exposeApi().expose()).toBe('sk-test');
    expect(p.exposeOAuthClientId()).toBe('cid');
    expect(p.exposeHarnessCommand()).toBe('claude');
  });
});

describe('baseUrl / defaultHeaders helpers', () => {
  it('surface the context values', () => {
    const p = new TestProvider(
      ctx(fullCreds, { baseUrl: 'https://x', defaultHeaders: { a: 'b' } }),
    );
    expect(p.exposeBaseUrl()).toBe('https://x');
    expect(p.exposeHeaders()).toEqual({ a: 'b' });
  });

  it('baseUrl is undefined when unset', () => {
    const p = new TestProvider(ctx(fullCreds));
    expect(p.exposeBaseUrl()).toBeUndefined();
  });
});

describe('models / activeModels helpers', () => {
  const models: readonly ModelInfo[] = [
    { name: 'claude-opus-4-8', enabled: true },
    { name: 'claude-haiku-4-5', enabled: false },
  ];

  it('surface every configured model', () => {
    const p = new TestProvider(ctx(fullCreds, { models }));
    expect(p.exposeModels()).toEqual(models);
  });

  it('narrow activeModels to the enabled ones', () => {
    const p = new TestProvider(ctx(fullCreds, { models }));
    expect(p.exposeActiveModels()).toEqual([{ name: 'claude-opus-4-8', enabled: true }]);
  });

  it('default to no models', () => {
    const p = new TestProvider(ctx(fullCreds));
    expect(p.exposeModels()).toEqual([]);
    expect(p.exposeActiveModels()).toEqual([]);
  });
});

describe('getHarnessResponse', () => {
  it('throws ProviderNotImplementedError by default', async () => {
    const p = new TestProvider(ctx(fullCreds));
    await expect(p.getHarnessResponse('hi')).rejects.toBeInstanceOf(ProviderNotImplementedError);
  });

  it('runs when a subclass overrides it', async () => {
    const p = new HarnessProvider(ctx(fullCreds));
    await expect(p.getHarnessResponse('go')).resolves.toBe('claude:default:go');
  });

  it('passes the public effort option through to the implementation', async () => {
    const p = new HarnessProvider(ctx(fullCreds));
    await expect(p.getHarnessResponse('go', { effort: 'xhigh' })).resolves.toBe('claude:xhigh:go');
  });
});

describe('buildHarnessEnv', () => {
  it('injects the harness secrets and scrubs ambient ones', () => {
    const p = new TestProvider(ctx(fullCreds));
    const env = p.exposeHarnessEnv({
      PATH: '/usr/bin',
      AWS_SECRET_ACCESS_KEY: 'should-be-dropped',
      OPENAI_API_KEY: 'also-dropped',
    });
    // Ambient inheritable var survives.
    expect(env['PATH']).toBe('/usr/bin');
    // Ambient sensitive vars are scrubbed.
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    // The deliberate, scoped harness secret is injected (exposed at point of use).
    expect(env['PROVIDER_API_KEY']).toBe('harness-key');
    // The child is marked untrusted.
    expect(env[UNTRUSTED_ENV_VAR]).toBe('1');
  });

  it('throws when no harness is configured', () => {
    const p = new TestProvider(ctx({ api: apiCred }));
    expect(() => p.exposeHarnessEnv({})).toThrow(UnsupportedAuthMethodError);
  });

  it('the injected key name is itself sensitive (would be denied if merely inherited)', () => {
    // Guards the design intent: PROVIDER_API_KEY only lands via deliberate
    // injection, never by inheritance — confirming the inject path is required.
    expect(isSensitiveKey('PROVIDER_API_KEY')).toBe(true);
  });
});
