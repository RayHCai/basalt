/**
 * `@basalt/model-provider` — how Basalt loads and talks to a model, a model
 * provider, or a full 3rd-party harness.
 *
 * A provider can be reached more than one way at once — a raw **API key**, an
 * **OAuth** exchange, and/or a **3rd-party harness** (`codex`, `claude`) driven
 * as a subprocess. This package defines the central CONTRACTS the individual
 * provider implementations extend, plus the framework-side helpers that resolve
 * connection details and secrets for them. An implementation's only job is to
 * turn an `input` into an `output`; everything about authenticating and
 * connecting is resolved for it and injected as a {@link ProviderContext}.
 *
 * ## The contract
 *
 * An implementation extends {@link BaseModelProvider} and implements:
 *
 *  1. `getResponse(model, input, type: 'API' | 'oAuth'): Promise<string>` — the
 *     required path (`type` selects which configured auth method to use).
 *  2. `getHarnessResponse(input, options?): Promise<string>` — OPTIONAL; only
 *     providers with a 3rd-party harness override it (the base throws otherwise).
 *
 * (Both currently resolve the full response text; a streaming variant is a
 * documented TODO — see `types.ts`.)
 *
 * The base class hands the implementation typed, secret-safe helpers:
 * `requireApiCredentials()` / `requireOAuthCredentials()` /
 * `requireHarnessCredentials()` return the credential for a method (or throw
 * {@link UnsupportedAuthMethodError} if the provider wasn't configured for it),
 * and `buildHarnessEnv()` produces the scrubbed, scoped-injection environment
 * for spawning a harness subprocess. Sensitive values stay inside
 * {@link Secret} boxes until an implementation `.expose()`s one at the point of
 * use.
 *
 * ## Getting a response
 *
 * A caller does NOT import or instantiate a concrete provider. It names the
 * provider, and the loader resolves the name to its installed implementation:
 *
 * ```ts
 * import { getResponse } from '@basalt/model-provider';
 *
 * const output = await getResponse('anthropic', 'claude-opus-4-8', input, 'API');
 * ```
 *
 * Internally the loader reads the provider's config from the shared
 * `@basalt/config` store, dynamic-`import()`s the module named by its
 * `source` field (installed under `<STATE_DIR>/agent/model-providers`),
 * constructs the default export with a {@link ProviderContext} built by
 * {@link contextFromConfig}, and delegates to it — runtime-checking each step and
 * raising a {@link ProviderLoadError} on failure. See `loader.ts`.
 *
 * The lower-level pieces are still exported for callers that already hold a
 * config store or resolved credentials: {@link contextFromConfig} builds a
 * context, and an implementation is `new`-ed with it. The context also carries
 * the provider's configured `models` (each a `{ name, enabled }` entry);
 * {@link BaseModelProvider} exposes `models()` and `activeModels()` so an
 * implementation can enumerate or gate on them.
 */

// The primary entry points: resolve a provider by NAME and get a response.
export {
  getHarnessResponse,
  getResponse,
  type LoadOptions,
  loadProvider,
  type ModuleImporter,
  resolveSourceSpecifier,
} from './loader.js';

// The central contract + the base class implementations extend.
export { BaseModelProvider, type ModelProvider } from './provider.js';

// The request/response value types and the harness-options bag.
export type {
  CustomHarnessOptions,
  HarnessEffort,
  ModelResponse,
  ResponseAuthType,
} from './types.js';

// The resolved credential shapes (the "all available ways to reach a provider").
export type {
  ApiCredentials,
  HarnessCredentials,
  OAuthCredentials,
  ProviderCredentials,
} from './credentials.js';

// The models a provider offers + the active-subset helper.
export { activeModels, type ModelInfo } from './models.js';

// The injected helper toolkit + its constructors.
export {
  type CreateProviderContextOptions,
  createProviderContext,
  type ProviderContext,
} from './context.js';

// Config-driven wiring: build credentials / models / a context from a loaded config store.
export {
  contextFromConfig,
  credentialsFromConfig,
  modelsFromConfig,
  type ResolvedModelProviderConfig,
} from './from-config.js';

// The error taxonomy.
export {
  ModelProviderError,
  ProviderLoadError,
  ProviderNotImplementedError,
  UnsupportedAuthMethodError,
} from './errors.js';
