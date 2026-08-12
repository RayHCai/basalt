/**
 * The request/response value types shared across the model-provider contracts.
 *
 * These are intentionally minimal: a model provider's only job is to turn an
 * `input` into an `output`. Everything about HOW it authenticates and connects
 * is resolved for it by the framework (see {@link ProviderContext}); an
 * implementation just receives text and returns text.
 */

/*
 * TODO(stream): a response is the full text today, resolved once the model has
 * finished. Add a streaming variant so `getResponse` / `getHarnessResponse` can
 * also yield token deltas — e.g. `AsyncIterable<string>` or a
 * `ModelResponseStream` — for callers that want to render output incrementally.
 * When that lands, `ModelResponse` becomes `string | ModelResponseStream` and
 * the contract methods gain an overload/option to opt into streaming.
 */

/**
 * A completed model response: the full output text. See the STREAM TODO above —
 * this widens to a streaming form once incremental delivery is supported.
 */
type ModelResponse = string;

/**
 * The interaction mode a caller selects at request time for
 * {@link ModelProvider.getResponse}:
 *
 *  - `'API'`   — a direct authenticated API call (uses the provider's API-key
 *    credentials).
 *  - `'oAuth'` — an OAuth-authenticated call (uses the provider's OAuth
 *    credentials — client id/secret, token URL, refresh token).
 *
 * A full 3rd-party harness (e.g. `codex`, `claude`) is a separate path
 * ({@link ModelProvider.getHarnessResponse}), not a value here, because it is
 * invoked and shaped differently.
 */
type ResponseAuthType = 'API' | 'oAuth';

/**
 * How hard a harness should work a request — the amount of thinking/exploration
 * it puts in before answering. Mirrors the effort ladder every current harness
 * exposes (`low` → `max`); a PUBLIC, harness-agnostic knob a caller sets without
 * knowing which harness is behind the provider.
 *
 * It is only a REQUEST: each provider maps it onto whatever its concrete harness
 * understands (a CLI flag, an env var, an API `effort` field, …) — see
 * {@link CustomHarnessOptions.effort}.
 */
type HarnessEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Options for {@link ModelProvider.getHarnessResponse}.
 *
 * A full 3rd-party harness (`claude`, `codex`, …) is driven differently from a
 * direct API call, and its knobs are largely harness-specific — so this stays an
 * OPEN bag (the index signature) that any implementation can read its own fields
 * from (workflow selection, working directory, timeout, session id, …) without a
 * contract change.
 *
 * The one field promoted to the shared, PUBLIC contract is {@link effort}: it is
 * meaningful across every harness, so a caller sets it uniformly and each
 * provider decides how to honor it (Claude Code, Codex, and others each translate
 * it onto their own invocation — a CLI flag, an env var, an API parameter). Any
 * other, provider-specific knob rides along on the open bag and is read by key.
 */
interface CustomHarnessOptions {
  /**
   * How hard the harness should work this request, if the caller wants to say.
   * Public and harness-agnostic; the provider translates it onto its concrete
   * harness (or ignores it). Absent means "let the harness use its own default".
   */
  readonly effort?: HarnessEffort;
  /** Provider/harness-specific knobs (workflow, cwd, timeout, …), read by key. */
  readonly [key: string]: unknown;
}

export type { CustomHarnessOptions, HarnessEffort, ModelResponse, ResponseAuthType };
