import type { Secret } from '@basalt/secrets';

/**
 * The resolved ways to authenticate to ONE model provider.
 *
 * A single provider (e.g. Anthropic) can be reachable more than one way at the
 * same time — a raw API key, an OAuth exchange, and/or a full 3rd-party harness
 * (`codex`, `claude`). So this is a bag of INDEPENDENT, all-OPTIONAL methods,
 * not a one-of union: whichever ones the provider is configured for are present.
 * The caller picks a method at request time (`getResponse(..., 'API' | 'oAuth')`
 * or `getHarnessResponse(...)`), and {@link BaseModelProvider} hands the
 * implementation the matching credential — or throws a clear error if that
 * method was never configured for this provider.
 *
 * Every sensitive value is a live {@link Secret} box (resolved from
 * `@basalt/config` / `@basalt/secrets`), never a bare string — an implementation
 * calls `.expose()` at the exact point of use.
 */
interface ProviderCredentials {
  /** API-key auth, if configured. Selected by `getResponse(..., 'API')`. */
  readonly api?: ApiCredentials;
  /** OAuth auth, if configured. Selected by `getResponse(..., 'oAuth')`. */
  readonly oauth?: OAuthCredentials;
  /** 3rd-party harness invocation, if configured. Used by `getHarnessResponse`. */
  readonly harness?: HarnessCredentials;
}

/** Credentials for a direct, API-key-authenticated call. */
interface ApiCredentials {
  /** The API/bearer key. */
  readonly apiKey: Secret;
}

/**
 * Credentials for an OAuth-authenticated call. The implementation performs the
 * token exchange at `tokenUrl` using these; the framework only resolves and
 * hands them over.
 *
 * `clientSecret` is OPTIONAL: a public OAuth client (PKCE, no secret) — which is
 * what a Claude Max / Claude Code subscription token is — has no client secret,
 * so a provider fronting one omits it and the refresh grant carries only
 * `client_id`. A confidential client sets it and the grant includes it.
 */
interface OAuthCredentials {
  readonly clientId: string;
  readonly clientSecret?: Secret;
  readonly tokenUrl: string;
  readonly refreshToken?: Secret;
  readonly scopes: readonly string[];
}

/**
 * Spec for invoking a full 3rd-party harness (e.g. `codex`, `claude`) as a
 * subprocess. `env` carries any provider secrets the harness reads from its own
 * environment; {@link BaseModelProvider.buildHarnessEnv} turns this into the
 * scrubbed, scoped-injection environment the subprocess is actually spawned with
 * (per `@basalt/secrets`' env-scrubbing threat model).
 */
interface HarnessCredentials {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, Secret>>;
}

export type { ApiCredentials, HarnessCredentials, OAuthCredentials, ProviderCredentials };
