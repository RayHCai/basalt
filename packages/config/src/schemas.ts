import { z } from 'zod';

import { secret } from './secret-field.js';

/**
 * The typed config schemas. Basalt has three kinds of config, matching the
 * README's `config/` layout:
 *
 *  - **main** — the singleton `config/main.json`. Strict (unknown keys are an
 *    error): this is Basalt's own top-level config and every field is known.
 *  - **model-provider** — one file per provider under `config/model-providers/`.
 *    Loose (unknown keys preserved) so a provider SDK can extend it via
 *    {@link defineModelProviderConfig} and a generic reader still round-trips an
 *    SDK-extended file without dropping fields.
 *  - **plugin** — one file per plugin under `config/plugins/`. Also loose, for
 *    the same reason.
 *
 * Secret-bearing fields use {@link secret}; on disk they hold only a
 * `{ "$secret": ref }` marker, and the store routes the plaintext through
 * `@basalt/secrets`.
 */

/**
 * Gateway connection settings. `accessToken` is sensitive (a bearer token), so
 * it is a {@link secret} field. `baseUrl` is validated as a URL; `timeoutMs` has
 * a sane default.
 */
const gatewaySchema = z
  .strictObject({
    baseUrl: z.url().optional(),
    timeoutMs: z.number().int().positive().default(30_000),
    accessToken: secret().optional(),
  })
  .prefault({});

/**
 * The main config schema. Strict, fully defaulted so an empty `{}` yields a
 * complete, valid config (used to seed the base template).
 */
const MainConfigSchema = z.strictObject({
  telemetry: z.boolean().default(false),
  gateway: gatewaySchema,
});

/** A fully-resolved, validated main config. */
type MainConfig = z.infer<typeof MainConfigSchema>;

/**
 * OAuth settings for a direct call: a client id exchanged (with an optional
 * refresh token) for an access token at `tokenUrl`, plus requested scopes.
 * `clientSecret` and `refreshToken` are {@link secret} fields (markers on disk).
 *
 * `clientSecret` is OPTIONAL because a public OAuth client (PKCE, no secret) —
 * e.g. a Claude Max / Claude Code subscription token — has none; only a
 * confidential client sets it. `strictObject` so a hand-edit typo (e.g.
 * `clientID`) is rejected rather than silently dropped alongside real
 * credentials.
 */
const oauthSchema = z.strictObject({
  clientId: z.string().min(1),
  clientSecret: secret().optional(),
  tokenUrl: z.url(),
  refreshToken: secret().optional(),
  scopes: z.array(z.string()).default([]),
});

/**
 * The ways Basalt can authenticate a DIRECT call to a model provider. A bag of
 * INDEPENDENT, all-optional methods rather than a one-of `kind` union: a single
 * provider may be reachable by more than one at once (e.g. an API key AND an
 * OAuth exchange), and the caller picks a method at request time. An empty bag
 * (`{}`, the default) means no direct-call auth is configured.
 *
 * The full 3rd-party harness path is deliberately NOT here — it lives at the
 * provider top level ({@link ModelProviderConfigSchema}'s `harness`), because it
 * is a way to RUN the provider as a subprocess, not a credential for a direct
 * call. `strictObject` to catch hand-edit typos in a delicate, secret-bearing
 * shape.
 */
const authSchema = z
  .strictObject({
    apiKey: secret().optional(),
    oauth: oauthSchema.optional(),
  })
  .default({});

/**
 * Spec for invoking a full 3rd-party harness (e.g. `codex`, `claude`) as a
 * subprocess. Each `env` value is a {@link secret} field, injected at spawn
 * time. `strictObject` for the same reason as {@link authSchema}.
 */
const harnessSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), secret()).default({}),
});

/**
 * A single model a provider offers. `name` is the model identifier a caller
 * passes to `getResponse` (e.g. `claude-opus-4-8`); `enabled` marks whether the
 * model is currently active — the provider's "active models" are those with
 * `enabled: true`. Stored as an object rather than a bare string so per-model
 * info (context window, aliases, …) can grow here later without a contract
 * change.
 */
const modelSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
});

/** A validated model entry (one model a provider offers). */
type ModelConfig = z.infer<typeof modelSchema>;

/**
 * Base model-provider config. `looseObject` so provider SDKs can add fields via
 * {@link defineModelProviderConfig} and unknown keys survive a generic load.
 *
 * `auth` carries the DIRECT-call credentials (API key and/or OAuth); `harness`
 * is the separate, optional way to run a full 3rd-party CLI (`codex`, `claude`)
 * as a subprocess — the two live side by side because a provider may offer both.
 * `models` records the provider's known models (each with an `enabled` flag); it
 * defaults to empty so a freshly-seeded provider carries none until edited.
 *
 * `source` is the location of the installed code that backs this
 * provider — an ESM module whose default export extends `BaseModelProvider`
 * (in `@basalt/model-provider`). It is what the model-provider loader
 * dynamic-imports to turn a provider NAME into a callable implementation.
 * Either an absolute path or a path relative to `<STATE_DIR>/agent/model-providers`
 * (where `basalt init` installs provider code). Optional so a freshly-seeded
 * provider can carry none until its code is installed; the loader raises a clear
 * error if it is missing when a response is requested.
 */
const ModelProviderConfigSchema = z.looseObject({
  enabled: z.boolean().default(true),
  baseUrl: z.url().optional(),
  source: z.string().min(1).optional(),
  auth: authSchema,
  harness: harnessSchema.optional(),
  defaultHeaders: z.record(z.string(), z.string()).default({}),
  models: z.array(modelSchema).default([]),
});

/** A validated model-provider config (base shape; SDKs extend it). */
type ModelProviderConfig = z.infer<typeof ModelProviderConfigSchema>;

/**
 * Base plugin config. `looseObject` for the same reason as model-provider.
 * `settings` is an open record by default; a plugin narrows it via
 * {@link definePluginConfig}.
 */
const PluginConfigSchema = z.looseObject({
  enabled: z.boolean().default(true),
  settings: z.record(z.string(), z.unknown()).default({}),
});

/** A validated plugin config (base shape; plugins narrow `settings`). */
type PluginConfig = z.infer<typeof PluginConfigSchema>;

/**
 * Base tool config. A shell for now — just an `enabled` flag — but `looseObject`
 * for the same reason as plugin/model-provider: a tool SDK can extend it via
 * {@link defineToolConfig} and a generic reader round-trips unknown keys.
 */
const ToolConfigSchema = z.looseObject({
  enabled: z.boolean().default(true),
});

/** A validated tool config (base shell; SDKs extend it). */
type ToolConfig = z.infer<typeof ToolConfigSchema>;

/**
 * Base MCP-server config. A shell for now — just an `enabled` flag — but
 * `looseObject` so an MCP-server SDK can extend it via {@link defineMcpServerConfig}
 * and a generic reader round-trips unknown keys.
 */
const McpServerConfigSchema = z.looseObject({
  enabled: z.boolean().default(true),
});

/** A validated MCP-server config (base shell; SDKs extend it). */
type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * The base model-provider schema type an extender receives — a loose object so
 * `.extend(...)` keeps the catchall (unknown keys still round-trip).
 */
type ModelProviderBase = typeof ModelProviderConfigSchema;

/**
 * Build a model-provider config schema, optionally extending the base with
 * provider-specific fields. The extender is handed the base schema and the
 * {@link secret} helper so an SDK can add its own secret-bearing fields that the
 * walker will discover automatically:
 *
 * ```ts
 * const schema = defineModelProviderConfig((base, secret) =>
 *   base.extend({ model: z.string(), webhookSecret: secret().optional() }),
 * );
 * ```
 */
function defineModelProviderConfig(
  extend?: (base: ModelProviderBase, secretField: typeof secret) => z.ZodObject,
): z.ZodObject {
  if (extend === undefined) {
    return ModelProviderConfigSchema;
  }
  return extend(ModelProviderConfigSchema, secret);
}

/**
 * Build a plugin config schema, optionally replacing the open `settings` record
 * with a typed schema. Everything else (the `enabled` flag, loose top level)
 * is preserved.
 *
 * ```ts
 * const schema = definePluginConfig(z.object({ repo: z.string() }));
 * ```
 */
function definePluginConfig(settingsSchema?: z.ZodType): z.ZodObject {
  if (settingsSchema === undefined) {
    return PluginConfigSchema;
  }
  return z.looseObject({
    enabled: z.boolean().default(true),
    settings: settingsSchema,
  });
}

/**
 * The base tool schema type an extender receives — a loose object so
 * `.extend(...)` keeps the catchall (unknown keys still round-trip).
 */
type ToolBase = typeof ToolConfigSchema;

/**
 * Build a tool config schema, optionally extending the base shell with
 * tool-specific fields. The extender is handed the base schema and the
 * {@link secret} helper so an SDK can add its own secret-bearing fields the
 * walker will discover automatically:
 *
 * ```ts
 * const schema = defineToolConfig((base, secret) =>
 *   base.extend({ endpoint: z.url(), apiKey: secret().optional() }),
 * );
 * ```
 */
function defineToolConfig(
  extend?: (base: ToolBase, secretField: typeof secret) => z.ZodObject,
): z.ZodObject {
  if (extend === undefined) {
    return ToolConfigSchema;
  }
  return extend(ToolConfigSchema, secret);
}

/**
 * The base MCP-server schema type an extender receives — a loose object so
 * `.extend(...)` keeps the catchall (unknown keys still round-trip).
 */
type McpServerBase = typeof McpServerConfigSchema;

/**
 * Build an MCP-server config schema, optionally extending the base shell with
 * server-specific fields. The extender is handed the base schema and the
 * {@link secret} helper so an SDK can add its own secret-bearing fields the
 * walker will discover automatically:
 *
 * ```ts
 * const schema = defineMcpServerConfig((base, secret) =>
 *   base.extend({ command: z.string(), env: z.record(z.string(), secret()) }),
 * );
 * ```
 */
function defineMcpServerConfig(
  extend?: (base: McpServerBase, secretField: typeof secret) => z.ZodObject,
): z.ZodObject {
  if (extend === undefined) {
    return McpServerConfigSchema;
  }
  return extend(McpServerConfigSchema, secret);
}

export {
  defineMcpServerConfig,
  defineModelProviderConfig,
  definePluginConfig,
  defineToolConfig,
  type MainConfig,
  MainConfigSchema,
  type McpServerConfig,
  McpServerConfigSchema,
  type ModelConfig,
  type ModelProviderConfig,
  ModelProviderConfigSchema,
  type PluginConfig,
  PluginConfigSchema,
  type ToolConfig,
  ToolConfigSchema,
};
