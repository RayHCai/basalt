/**
 * Errors raised by `@basalt/model-provider`.
 *
 * Like `@basalt/runtime`, these carry NO process exit code — mapping a failure
 * to an exit code is a higher layer's concern. They are the taxonomy the
 * framework and provider implementations raise so a caller can distinguish
 * "this provider isn't configured that way" from "the provider hasn't
 * implemented that path yet" from a generic failure.
 */

/* oxlint-disable max-classes-per-file -- a small error taxonomy belongs together */

/** Base class for every error this package raises intentionally. */
class ModelProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelProviderError';
  }
}

/**
 * A caller asked for an authentication method (`'API'`, `'oAuth'`, or the
 * harness path) that this provider was never configured for. Carries the
 * provider name and the method so the message is actionable; both are
 * non-sensitive labels, safe to log.
 */
class UnsupportedAuthMethodError extends ModelProviderError {
  readonly provider: string;
  readonly method: string;

  constructor(provider: string, method: string) {
    super(`Model provider "${provider}" is not configured for ${method} authentication`);
    this.name = 'UnsupportedAuthMethodError';
    this.provider = provider;
    this.method = method;
  }
}

/**
 * A contract method a provider implementation has not backed with real behavior
 * yet — most commonly the optional {@link ModelProvider.getHarnessResponse}.
 * {@link BaseModelProvider} throws this from its default `getHarnessResponse`.
 */
class ProviderNotImplementedError extends ModelProviderError {
  constructor(feature: string) {
    super(`${feature} is not implemented by this model provider`);
    this.name = 'ProviderNotImplementedError';
  }
}

/**
 * The loader could not turn a provider NAME into a usable implementation: the
 * config named no `source`, the module file could not be imported, its
 * default export was missing, or the constructed value did not satisfy the
 * {@link ModelProvider} shape. Carries the provider name (a safe-to-log label)
 * and, when the failure originated in imported code, the underlying `cause` so
 * the root error is not swallowed.
 */
class ProviderLoadError extends ModelProviderError {
  readonly provider: string;

  constructor(provider: string, detail: string, options?: { cause?: unknown }) {
    super(`Cannot load model provider "${provider}": ${detail}`, options);
    this.name = 'ProviderLoadError';
    this.provider = provider;
  }
}

export {
  ModelProviderError,
  ProviderLoadError,
  ProviderNotImplementedError,
  UnsupportedAuthMethodError,
};
