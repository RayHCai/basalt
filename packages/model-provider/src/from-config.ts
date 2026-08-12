import type { ConfigStore, ModelProviderConfig, ResolveSecrets } from '@basalt/config';

import { createProviderContext } from './context.js';
import type { ProviderContext } from './context.js';
import type { ProviderCredentials } from './credentials.js';
import { ModelProviderError } from './errors.js';
import type { ModelInfo } from './models.js';

/** A model-provider config with its secret markers resolved to live boxes. */
type ResolvedModelProviderConfig = ResolveSecrets<ModelProviderConfig>;

/**
 * Turn a resolved model-provider config into the framework's
 * {@link ProviderCredentials} bag.
 *
 * The config `auth` is itself a bag of optional direct-call methods (`apiKey`
 * and/or `oauth`), and `harness` sits beside it at the provider top level — so
 * this is a direct field-by-field map, and any combination present in config
 * flows through. An absent method is simply omitted from the bag; a provider
 * configured for none yields `{}`.
 */
function credentialsFromConfig(config: ResolvedModelProviderConfig): ProviderCredentials {
  const { auth, harness } = config;
  return {
    ...(auth.apiKey === undefined ? {} : { api: { apiKey: auth.apiKey } }),
    ...(auth.oauth === undefined
      ? {}
      : {
          oauth: {
            clientId: auth.oauth.clientId,
            tokenUrl: auth.oauth.tokenUrl,
            scopes: auth.oauth.scopes,
            ...(auth.oauth.clientSecret === undefined
              ? {}
              : { clientSecret: auth.oauth.clientSecret }),
            ...(auth.oauth.refreshToken === undefined
              ? {}
              : { refreshToken: auth.oauth.refreshToken }),
          },
        }),
    ...(harness === undefined
      ? {}
      : { harness: { command: harness.command, args: harness.args, env: harness.env } }),
  };
}

/**
 * Turn a resolved model-provider config's `models` list into the framework's
 * {@link ModelInfo} array. A 1:1 shape map today; kept as its own function so a
 * later config that carries richer per-model fields maps in one place.
 */
function modelsFromConfig(config: ResolvedModelProviderConfig): readonly ModelInfo[] {
  return config.models.map((model) => ({ name: model.name, enabled: model.enabled }));
}

/**
 * Build the {@link ProviderContext} for `name` from a loaded {@link ConfigStore}
 * — the framework's primary entry point. It reads the provider's config
 * (resolving secret markers to live boxes), maps its auth into credentials, and
 * assembles the context an implementation is constructed with.
 *
 * Throws {@link ModelProviderError} if the store has no provider by that name.
 */
function contextFromConfig(store: ConfigStore, name: string): ProviderContext {
  const config = store.modelProvider(name);
  if (config === undefined) {
    throw new ModelProviderError(`No model provider named "${name}" is configured`);
  }
  return createProviderContext({
    name,
    credentials: credentialsFromConfig(config),
    models: modelsFromConfig(config),
    defaultHeaders: config.defaultHeaders,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  });
}

export {
  contextFromConfig,
  credentialsFromConfig,
  modelsFromConfig,
  type ResolvedModelProviderConfig,
};
