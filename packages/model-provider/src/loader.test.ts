/* oxlint-disable max-classes-per-file -- small provider test doubles belong together */
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConfigStore } from '@basalt/config';
import { Secret } from '@basalt/secrets';
import { describe, expect, it } from 'vitest';

import { ProviderLoadError } from './errors.js';
import type { ResolvedModelProviderConfig } from './from-config.js';
import { getHarnessResponse, getResponse, loadProvider, resolveSourceSpecifier } from './loader.js';
import type { ModuleImporter } from './loader.js';
import { BaseModelProvider } from './provider.js';
import type { ModelResponse } from './types.js';

/** Build a resolved model-provider config for a given source/auth shape. */
function cfg(
  parts: Partial<Pick<ResolvedModelProviderConfig, 'auth' | 'harness' | 'models'>> & {
    source?: string;
  } = {},
): ResolvedModelProviderConfig {
  return {
    enabled: true,
    auth: parts.auth ?? { apiKey: new Secret('sk') },
    defaultHeaders: {},
    models: parts.models ?? [],
    ...(parts.source === undefined ? {} : { source: parts.source }),
    ...(parts.harness === undefined ? {} : { harness: parts.harness }),
  } as ResolvedModelProviderConfig;
}

/** A ConfigStore stub whose `modelProvider(name)` returns `config` for `name`. */
function fakeStore(name: string, config?: ResolvedModelProviderConfig): ConfigStore {
  return {
    modelProvider: (n: string) => (n === name ? config : undefined),
  } as unknown as ConfigStore;
}

/** A concrete provider double whose responses echo their arguments. */
class EchoProvider extends BaseModelProvider {
  protected getAPIResponse(model: string, input: string): Promise<ModelResponse> {
    return Promise.resolve(`api:${model}:${input}`);
  }

  protected getOAuthResponse(model: string, input: string): Promise<ModelResponse> {
    return Promise.resolve(`oauth:${model}:${input}`);
  }

  override getHarnessResponse(input: string): Promise<ModelResponse> {
    return Promise.resolve(`harness:${input}`);
  }
}

/** An importer that resolves `default` to `exported` for any specifier. */
function importerFor(exported: unknown): ModuleImporter {
  return () => Promise.resolve({ default: exported });
}

const env = { BASALT_STATE_DIR: '/state' } as const;

describe('resolveSourceSpecifier', () => {
  it('resolves a relative path under agent/model-providers', () => {
    const href = resolveSourceSpecifier('anthropic/index.js', env);
    const path = fileURLToPath(href);
    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe('/state/agent/model-providers/anthropic/index.js');
  });

  it('uses an absolute path as-is', () => {
    const href = resolveSourceSpecifier('/opt/impls/anthropic.js', env);
    expect(fileURLToPath(href)).toBe('/opt/impls/anthropic.js');
  });

  it('produces a file:// URL so import() treats it as a path', () => {
    expect(resolveSourceSpecifier('/opt/x.js', env).startsWith('file://')).toBe(true);
  });
});

describe('loadProvider', () => {
  it('constructs the default export with a context and returns it', async () => {
    const impl = await loadProvider('anthropic', {
      store: fakeStore('anthropic', cfg({ source: 'anthropic/index.js' })),
      env,
      importModule: importerFor(EchoProvider),
    });
    expect(impl).toBeInstanceOf(EchoProvider);
  });

  it('throws when the provider is not configured', async () => {
    await expect(
      loadProvider('missing', {
        store: fakeStore('anthropic', cfg({ source: 'x.js' })),
        env,
        importModule: importerFor(EchoProvider),
      }),
    ).rejects.toBeInstanceOf(ProviderLoadError);
  });

  it('throws when the config declares no source path', async () => {
    await expect(
      loadProvider('anthropic', {
        store: fakeStore('anthropic', cfg()),
        env,
        importModule: importerFor(EchoProvider),
      }),
    ).rejects.toThrow(/source/u);
  });

  it('wraps an import failure as ProviderLoadError with a cause', async () => {
    const boom = new Error('ENOENT');
    await expect(
      loadProvider('anthropic', {
        store: fakeStore('anthropic', cfg({ source: 'gone.js' })),
        env,
        importModule: () => Promise.reject(boom),
      }),
    ).rejects.toMatchObject({ name: 'ProviderLoadError', cause: boom });
  });

  it('throws when the module has no constructable default export', async () => {
    await expect(
      loadProvider('anthropic', {
        store: fakeStore('anthropic', cfg({ source: 'x.js' })),
        env,
        importModule: importerFor({ notAClass: true }),
      }),
    ).rejects.toThrow(/default export/u);
  });

  it('wraps a constructor that throws, preserving the cause', async () => {
    const boom = new Error('bad ctor');
    // oxlint-disable-next-line no-extraneous-class -- a deliberately broken ctor double
    class Exploding {
      constructor() {
        throw boom;
      }
    }
    await expect(
      loadProvider('anthropic', {
        store: fakeStore('anthropic', cfg({ source: 'x.js' })),
        env,
        importModule: importerFor(Exploding),
      }),
    ).rejects.toMatchObject({ name: 'ProviderLoadError', cause: boom });
  });

  it('throws when the constructed value lacks getResponse', async () => {
    // oxlint-disable-next-line no-extraneous-class -- an empty double lacking the contract method
    class NotAProvider {
      // no getResponse
    }
    await expect(
      loadProvider('anthropic', {
        store: fakeStore('anthropic', cfg({ source: 'x.js' })),
        env,
        importModule: importerFor(NotAProvider),
      }),
    ).rejects.toThrow(/ModelProvider contract/u);
  });
});

describe('getResponse', () => {
  it('delegates to the loaded implementation (API path)', async () => {
    const out = await getResponse('anthropic', 'opus-4.6', 'hi', 'API', {
      store: fakeStore('anthropic', cfg({ source: 'x.js' })),
      env,
      importModule: importerFor(EchoProvider),
    });
    expect(out).toBe('api:opus-4.6:hi');
  });

  it('selects the oAuth path from the type argument', async () => {
    const out = await getResponse('anthropic', 'opus-4.6', 'hi', 'oAuth', {
      store: fakeStore('anthropic', cfg({ auth: {}, source: 'x.js' })),
      env,
      importModule: importerFor(EchoProvider),
    });
    expect(out).toBe('oauth:opus-4.6:hi');
  });
});

describe('getHarnessResponse', () => {
  it('delegates to the loaded implementation harness path', async () => {
    const out = await getHarnessResponse('anthropic', 'go', undefined, {
      store: fakeStore('anthropic', cfg({ source: 'x.js' })),
      env,
      importModule: importerFor(EchoProvider),
    });
    expect(out).toBe('harness:go');
  });

  it('throws when the implementation exposes no getHarnessResponse', async () => {
    // A provider with only getResponse (no harness method at all) — satisfies the
    // ModelProvider contract but has no harness path to drive.
    class ApiOnlyProvider {
      getResponse(): Promise<ModelResponse> {
        return Promise.resolve('x');
      }
    }
    await expect(
      getHarnessResponse('anthropic', 'go', undefined, {
        store: fakeStore('anthropic', cfg({ source: 'x.js' })),
        env,
        importModule: importerFor(ApiOnlyProvider),
      }),
    ).rejects.toThrow(/getHarnessResponse/u);
  });
});
