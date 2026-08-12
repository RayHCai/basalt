import { getLogger } from '@basalt/observability';
import type { Logger } from '@basalt/observability';

import type { ProviderCredentials } from './credentials.js';
import type { ModelInfo } from './models.js';

/**
 * The helper toolkit the framework builds and injects into every model-provider
 * implementation (via {@link BaseModelProvider}). It is the ONLY thing an
 * implementation is given: the resolved credentials (all the ways this provider
 * can be reached), the models it offers, a scoped logger, and — computed on
 * demand — the scrubbed environment for spawning a 3rd-party harness.
 *
 * The framework owns constructing this (see {@link createProviderContext}), so
 * an implementation never touches `@basalt/config` or `@basalt/secrets`
 * directly. Everything sensitive stays inside {@link Secret} boxes.
 */
interface ProviderContext {
  /** The provider's registered name (a non-sensitive label, safe to log). */
  readonly name: string;
  /** All auth methods this provider is configured for. */
  readonly credentials: ProviderCredentials;
  /** The models this provider offers, each with its `enabled` (active) flag. */
  readonly models: readonly ModelInfo[];
  /**
   * Base URL for the provider's API, if one is configured. An implementation
   * that talks to the default vendor endpoint can ignore this.
   */
  readonly baseUrl?: string;
  /** Default headers to merge into every request the implementation makes. */
  readonly defaultHeaders: Readonly<Record<string, string>>;
  /** A logger scoped to this provider (`basalt.model-provider.<name>`). */
  readonly logger: Logger;
}

/** Options for {@link createProviderContext}. */
interface CreateProviderContextOptions {
  /** The provider's registered name. Used for logging and error messages. */
  name: string;
  /** The resolved credentials (all configured auth methods). */
  credentials: ProviderCredentials;
  /** The models this provider offers (defaults to none). */
  models?: readonly ModelInfo[];
  /** Optional API base URL. */
  baseUrl?: string;
  /** Default request headers (defaults to none). */
  defaultHeaders?: Readonly<Record<string, string>>;
  /**
   * Logger to use. Defaults to a subsystem logger tagged
   * `basalt.model-provider.<name>` from `@basalt/observability`. Injectable so a
   * caller (or a test) can supply its own.
   */
  logger?: Logger;
}

/**
 * Build the {@link ProviderContext} the framework injects into a provider
 * implementation. Callers that already have credentials resolved use this
 * directly; the config-driven path is {@link contextFromConfig}.
 */
function createProviderContext(options: CreateProviderContextOptions): ProviderContext {
  const context: ProviderContext = {
    name: options.name,
    credentials: options.credentials,
    models: options.models ?? [],
    defaultHeaders: options.defaultHeaders ?? {},
    logger: options.logger ?? getLogger(`model-provider.${options.name}`),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  };
  return context;
}

export { type CreateProviderContextOptions, createProviderContext, type ProviderContext };
