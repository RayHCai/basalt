import { scrubEnvironment } from '@basalt/secrets';

import type { ProviderContext } from './context.js';
import type { ApiCredentials, HarnessCredentials, OAuthCredentials } from './credentials.js';
import { ProviderNotImplementedError, UnsupportedAuthMethodError } from './errors.js';
import { activeModels } from './models.js';
import type { ModelInfo } from './models.js';
import type { CustomHarnessOptions, ModelResponse, ResponseAuthType } from './types.js';

/**
 * The central contract every model-provider implementation satisfies. This is
 * the whole external surface an implementation must provide: turn an `input`
 * into an `output`. HOW it authenticates and connects is resolved for it by the
 * framework and handed over as a {@link ProviderContext}.
 *
 * Implementations should extend {@link BaseModelProvider} rather than implement
 * this interface directly — the base class holds the injected context and
 * exposes the credential/env helpers described below.
 */
interface ModelProvider {
  /**
   * Produce a response for `input` from `model`, using the `type` interaction
   * method (`'API'` or `'oAuth'`). Rejects with {@link UnsupportedAuthMethodError}
   * if the provider was not configured for that method.
   *
   * This is the single public entry point. {@link BaseModelProvider} implements
   * it as a fixed branch on `type` that dispatches to the method-specific
   * implementations a subclass supplies (`getAPIResponse` / `getOAuthResponse`),
   * so an implementation never re-writes the branch itself.
   *
   * TODO(stream): add a streaming counterpart (or an option/overload) once
   * {@link ModelResponse} widens — see the STREAM TODO in `types.ts`.
   */
  getResponse: (model: string, input: string, type: ResponseAuthType) => Promise<ModelResponse>;

  /**
   * OPTIONAL. Produce a response by driving a full 3rd-party harness (e.g.
   * `codex`, `claude`) as a subprocess. Present only for providers that ship a
   * harness integration; {@link BaseModelProvider} supplies a default that
   * throws {@link ProviderNotImplementedError}.
   *
   * TODO(stream): add a streaming counterpart once {@link ModelResponse} widens
   * — a harness subprocess naturally emits output incrementally.
   */
  getHarnessResponse?: (input: string, options?: CustomHarnessOptions) => Promise<ModelResponse>;
}

/**
 * The base class model-provider implementations EXTEND. It receives the
 * framework-built {@link ProviderContext} in its constructor and exposes the
 * secret/credential helpers an implementation uses, so a subclass focuses only
 * on turning input into output:
 *
 * The public {@link getResponse} is already implemented here: it branches on the
 * `type` and calls the matching method-specific implementation. A subclass only
 * fills in the two per-method hooks — it never re-writes the branch:
 *
 * ```ts
 * class AnthropicProvider extends BaseModelProvider {
 *   protected async getAPIResponse(model: string, input: string) {
 *     const { apiKey } = this.requireApiCredentials();
 *     // fetch(this.baseUrl() ?? DEFAULT, { headers: { 'x-api-key': apiKey.expose() }, ... })
 *     return output;
 *   }
 *
 *   protected async getOAuthResponse(model: string, input: string) {
 *     const oauth = this.requireOAuthCredentials();
 *     // exchange oauth.* for a token, then call the API
 *     return output;
 *   }
 * }
 * ```
 *
 * The `require*` helpers mean "return the credential for this method, or throw a
 * clear {@link UnsupportedAuthMethodError} if this provider was not configured
 * for it" — mirroring `@basalt/secrets`' own `require()`.
 */
abstract class BaseModelProvider implements ModelProvider {
  protected readonly context: ProviderContext;

  constructor(context: ProviderContext) {
    this.context = context;
  }

  /**
   * The fixed public entry point. Branches on `type` and delegates to the
   * method-specific implementation a subclass supplies. Subclasses do NOT
   * override this — they implement {@link getAPIResponse} / {@link getOAuthResponse}.
   */
  getResponse(model: string, input: string, type: ResponseAuthType): Promise<ModelResponse> {
    if (type === 'API') {
      return this.getAPIResponse(model, input);
    }
    return this.getOAuthResponse(model, input);
  }

  /**
   * API-key path: produce a response using this provider's API credentials
   * (see {@link requireApiCredentials}). Invoked by {@link getResponse} when the
   * caller selects `'API'`.
   *
   * TODO(stream): see the interface's STREAM TODO.
   */
  protected abstract getAPIResponse(model: string, input: string): Promise<ModelResponse>;

  /**
   * OAuth path: produce a response using this provider's OAuth credentials
   * (see {@link requireOAuthCredentials}). Invoked by {@link getResponse} when the
   * caller selects `'oAuth'`.
   *
   * TODO(stream): see the interface's STREAM TODO.
   */
  protected abstract getOAuthResponse(model: string, input: string): Promise<ModelResponse>;

  /**
   * Default harness path: not implemented. A provider with a 3rd-party harness
   * overrides this; one without inherits a clear {@link ProviderNotImplementedError}.
   *
   * TODO(stream): see the interface's STREAM TODO.
   */
  // oxlint-disable-next-line require-await -- async is part of the contract; the default just throws
  async getHarnessResponse(
    _input: string,
    _options?: CustomHarnessOptions,
  ): Promise<ModelResponse> {
    throw new ProviderNotImplementedError(`harness response for provider "${this.context.name}"`);
  }

  /** Every model this provider offers, active or not. */
  protected models(): readonly ModelInfo[] {
    return this.context.models;
  }

  /** Only the currently-active models (those with `enabled: true`). */
  protected activeModels(): readonly ModelInfo[] {
    return activeModels(this.context.models);
  }

  /** The provider's API base URL, if configured. */
  protected baseUrl(): string | undefined {
    return this.context.baseUrl;
  }

  /** Default headers to merge into every request. */
  protected defaultHeaders(): Readonly<Record<string, string>> {
    return this.context.defaultHeaders;
  }

  /** API-key credentials, or throw if this provider isn't configured for API auth. */
  protected requireApiCredentials(): ApiCredentials {
    const { api } = this.context.credentials;
    if (api === undefined) {
      throw new UnsupportedAuthMethodError(this.context.name, 'API');
    }
    return api;
  }

  /** OAuth credentials, or throw if this provider isn't configured for OAuth. */
  protected requireOAuthCredentials(): OAuthCredentials {
    const { oauth } = this.context.credentials;
    if (oauth === undefined) {
      throw new UnsupportedAuthMethodError(this.context.name, 'oAuth');
    }
    return oauth;
  }

  /** Harness credentials, or throw if this provider has no harness configured. */
  protected requireHarnessCredentials(): HarnessCredentials {
    const { harness } = this.context.credentials;
    if (harness === undefined) {
      throw new UnsupportedAuthMethodError(this.context.name, 'harness');
    }
    return harness;
  }

  /**
   * Build the environment to spawn the 3rd-party harness subprocess with. Starts
   * from a default-DENY scrub of the parent environment (via
   * `@basalt/secrets`' {@link scrubEnvironment}) so no ambient secrets leak into
   * the child, then injects THIS provider's harness secrets (exposed here, at
   * the point of use) as a deliberate, scoped injection.
   *
   * The returned record is a plain `string → string` map ready for
   * `child_process.spawn`'s `env`. Exposing the harness secrets is unavoidable —
   * the subprocess reads them from its own environment — so this is the single,
   * auditable disclosure point for the harness path.
   */
  protected buildHarnessEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const { env } = this.requireHarnessCredentials();
    const inject: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      inject[key] = value.expose();
    }
    return scrubEnvironment(source, { inject });
  }
}

export { BaseModelProvider, type ModelProvider };
