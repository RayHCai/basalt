/**
 * `@basalt/config` — create, manage, and typed-retrieve Basalt configuration.
 *
 * Config is layered on `@basalt/secrets`: any sensitive field (a gateway token,
 * a provider API key, a harness's env secrets) is stored on disk only as a
 * `{ "$secret": ref }` marker, while the plaintext is sealed in the encrypted
 * secret store. Getters resolve markers to live {@link Secret} boxes; `redacted*`
 * views show `[redacted]`; setters accept plaintext or a `Secret` and seal it.
 *
 * There are five kinds of config, matching `<STATE_DIR>/config/`:
 *   - **main** — the singleton `main.json` (gateway, telemetry).
 *   - **model-provider** — one file per provider: an `auth` bag of optional
 *     direct-call methods (`apiKey` and/or `oauth`), an optional `harness` (a
 *     3rd-party CLI run as a subprocess), and a `models` list (each model an
 *     object with a `name` and an `enabled` flag).
 *   - **plugin** — one file per plugin (enabled flag + settings).
 *   - **tool** — one file per tool (enabled flag; a shell SDKs extend).
 *   - **mcp-server** — one file per MCP server (enabled flag; a shell SDKs extend).
 *
 * ```ts
 * import { createConfigStore, secretsDir } from '@basalt/config';
 * import { createSecretStore } from '@basalt/secrets';
 *
 * const secrets = await createSecretStore({ dir: secretsDir() });
 * const config = await createConfigStore({ secrets });
 * await config.init();   // seed main.json if absent
 * await config.load();   // validate everything into cache
 *
 * config.main().telemetry;                       // typed, sync
 * await config.setMain({ gateway: { accessToken: process.env.TOKEN! } });
 * config.main().gateway.accessToken?.expose();  // a live Secret, resolved
 *
 * const path = await config.createModelProvider('anthropic'); // seed + register
 * // → <STATE_DIR>/config/model-providers/anthropic.json, edit the rest by hand
 * ```
 *
 * `basalt init` runs {@link initConfig}, which wires the two stores together and
 * returns a loaded store plus a setup summary.
 */

// Shared singleton — how other packages consume config without wiring.
export {
  configureConfig,
  type ConfigureConfigOptions,
  getConfig,
  resetConfig,
} from './singleton.js';

// Store + init — the primary surface.
export { type ConfigStore, type ConfigStoreOptions, createConfigStore } from './store.js';
export {
  type CreatableKind,
  createConfigSection,
  type CreateConfigSectionOptions,
  type CreateConfigSectionResult,
  initConfig,
  type InitConfigOptions,
  type InitConfigResult,
} from './init.js';

// Schemas + extension helpers (SDKs build on these).
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
} from './schemas.js';
export { createSchemaRegistry, type SchemaRegistry } from './registry.js';

// Set a single config secret (behind `basalt secret set <name>`), sealing it
// under the derived store name config resolves markers to.
export { setSecret, type SetSecretOptions } from './set-secret.js';

// Secret-field helper + the mapped types describing retrieved/redacted/input forms.
export {
  type PatchInput,
  type RedactSecrets,
  REDACTED,
  type ResolveSecrets,
  secret,
  type SecretInput,
  type SecretInputs,
  type SecretRef,
} from './secret-field.js';

// Paths + name validation (state-dir resolution, section-name guard).
export {
  AGENT_DIR_NAME,
  agentDir,
  AGENT_MCPS_DIR_NAME,
  agentMcpsDir,
  AGENT_MODEL_PROVIDERS_DIR_NAME,
  agentModelProvidersDir,
  AGENT_TOOLS_DIR_NAME,
  agentToolsDir,
  AGENT_WORKSPACE_DIR_ENV_VAR,
  AGENT_WORKSPACE_DIR_NAME,
  agentWorkspaceBaseDir,
  agentWorkspaceDir,
  agentWorkspaceSessionDir,
  AGENT_WORKSPACE_SESSIONS_DIR_NAME,
  agentWorkspaceSessionsDir,
  AGENT_WORKSPACE_SHARED_DIR_NAME,
  agentWorkspaceSharedDir,
  agentWorkspaceSharedEntryDir,
  CONFIG_DIR_NAME,
  configDir,
  type Env,
  MAIN_CONFIG_FILE,
  mainConfigFile,
  MCP_SERVERS_DIR_NAME,
  mcpServerFile,
  mcpServersDir,
  MODEL_PROVIDERS_DIR_NAME,
  modelProviderFile,
  modelProvidersDir,
  PLUGINS_DIR_NAME,
  pluginFile,
  pluginsDir,
  SECRETS_DIR_NAME,
  secretsDir,
  STATE_DIR_ENV_VAR,
  STATE_DIR_NAME,
  stateDir,
  STORAGE_DIR_NAME,
  storageDir,
  TOOLS_DIR_NAME,
  toolFile,
  toolsDir,
} from './paths.js';
export { assertValidName, isValidName, MAX_NAME_LENGTH } from './names.js';
