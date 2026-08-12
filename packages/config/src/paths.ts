import { isAbsolute, join, resolve } from 'node:path';

/**
 * Environment variable that relocates the runtime state directory. `@basalt/config`
 * OWNS state-dir resolution per the root README (state is "managed by
 * config/storage"): this is the ONLY place the env var and the default live.
 * `@basalt/observability` imports {@link stateDir} from here, and `@basalt/secrets`
 * takes an explicit `dir` that config computes via {@link secretsDir} — secrets
 * no longer resolves the location itself, so there is one default, here. When
 * unset, {@link stateDir} falls back to `<cwd>/.basalt`.
 */
const STATE_DIR_ENV_VAR = 'BASALT_STATE_DIR';

/** Default state directory name, created under cwd when `BASALT_STATE_DIR` is unset. */
const STATE_DIR_NAME = '.basalt';

/**
 * Directory (under STATE_DIR) holding installed AGENT CODE — the tool/MCP/model-
 * provider implementations the agent loads at runtime. Distinct from `config/`,
 * which holds the JSON that describes/enables them: `agent/` is the code, `config/`
 * is the settings. `basalt init` creates this tree so the handlers have somewhere
 * to install into on a fresh machine.
 */
const AGENT_DIR_NAME = 'agent';

/** Directory (under the agent dir) holding installed tool code, loaded by the tools handler. */
const AGENT_TOOLS_DIR_NAME = 'tools';

/** Directory (under the agent dir) holding installed MCP servers, loaded by the MCP handler. */
const AGENT_MCPS_DIR_NAME = 'mcps';

/** Directory (under the agent dir) holding installed model-provider harnesses. */
const AGENT_MODEL_PROVIDERS_DIR_NAME = 'model-providers';

/**
 * Environment variable that relocates the AGENT WORKSPACE base directory — the
 * parent under which the `.agent-workspace/` tree (a spawned agent run's
 * per-session working directory) is created. Distinct from `BASALT_STATE_DIR`:
 * STATE_DIR is the PLATFORM tree (config, secrets, logs, installed agent code),
 * while the agent workspace is where agent RUNS actually write files.
 *
 * When unset, {@link agentWorkspaceBaseDir} falls back to {@link stateDir}, so by
 * default the workspace co-locates with the platform state. Point this at a
 * location OUTSIDE the platform tree to make config/secrets/policy a SIBLING of
 * the workspace rather than an ancestor — then they are unreachable by a relative
 * write from a session cwd regardless of enforcement, which is the intended
 * production posture (the boundary the later sandbox builds on).
 */
const AGENT_WORKSPACE_DIR_ENV_VAR = 'BASALT_AGENT_WORKSPACE_DIR';

/**
 * Name of the workspace ROOT directory created under the agent-workspace base.
 * A dotfile so it reads as managed state, mirroring `.basalt`.
 */
const AGENT_WORKSPACE_DIR_NAME = '.agent-workspace';

/** Directory (under the workspace root) holding cross-session, shared artifacts. */
const AGENT_WORKSPACE_SHARED_DIR_NAME = 'shared';

/** Directory (under the workspace root) holding one subdirectory per session cwd. */
const AGENT_WORKSPACE_SESSIONS_DIR_NAME = 'sessions';

/** Directory (under STATE_DIR) that holds all config files. */
const CONFIG_DIR_NAME = 'config';

/**
 * Directory (under STATE_DIR) that holds the SQLite storage database. Config
 * owns this location — it passes {@link storageDir} into `@basalt/storage`,
 * which never resolves where state lives. The sessions DB is
 * `<STATE_DIR>/storage/basalt.db`.
 */
const STORAGE_DIR_NAME = 'storage';

/**
 * Directory (under STATE_DIR) that holds the encrypted secret store. Config owns
 * this location — it passes {@link secretsDir} into `@basalt/secrets`, which no
 * longer resolves where state lives. Keeps one STATE_DIR default in this package.
 */
const SECRETS_DIR_NAME = 'secrets';

/** The singleton main config file, directly under the config dir. */
const MAIN_CONFIG_FILE = 'main.json';

/** Directory (under the config dir) holding per-model-provider config files. */
const MODEL_PROVIDERS_DIR_NAME = 'model-providers';

/** Directory (under the config dir) holding per-plugin config files. */
const PLUGINS_DIR_NAME = 'plugins';

/** Directory (under the config dir) holding per-tool config files. */
const TOOLS_DIR_NAME = 'tools';

/** Directory (under the config dir) holding per-MCP-server config files. */
const MCP_SERVERS_DIR_NAME = 'mcp-servers';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Absolute path to the runtime state directory. Honors `BASALT_STATE_DIR`
 * (resolved against cwd if relative); otherwise `<cwd>/.basalt`.
 * The single source of truth for state-dir resolution: `@basalt/observability`
 * imports this, and `@basalt/secrets` is handed {@link secretsDir} — both derive
 * from here, so `config`, `logs`, and `secrets` land side by side under one root.
 *
 * TODO: default the state dir to `~/.basalt` (the user's home directory) instead
 * of `<cwd>/.basalt`, so state is per-user rather than per-directory.
 */
function stateDir(env: Env = process.env): string {
  const override = env[STATE_DIR_ENV_VAR];
  if (typeof override === 'string' && override.length > 0) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return join(process.cwd(), STATE_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/config`. */
function configDir(env: Env = process.env): string {
  return join(stateDir(env), CONFIG_DIR_NAME);
}

/**
 * Absolute path to `<STATE_DIR>/secrets`. Passed into `@basalt/secrets` so the
 * encrypted store and master key sit beside `config/` under one STATE_DIR.
 */
function secretsDir(env: Env = process.env): string {
  return join(stateDir(env), SECRETS_DIR_NAME);
}

/**
 * Absolute path to `<STATE_DIR>/storage`. Passed into `@basalt/storage` so the
 * SQLite sessions database sits beside `config/` and `secrets/` under one
 * STATE_DIR.
 */
function storageDir(env: Env = process.env): string {
  return join(stateDir(env), STORAGE_DIR_NAME);
}

/**
 * Absolute path to `<STATE_DIR>/agent` — the root for installed agent code
 * (tools, MCP servers, model-provider harnesses). Sits beside `config/` and
 * `secrets/` under one STATE_DIR.
 */
function agentDir(env: Env = process.env): string {
  return join(stateDir(env), AGENT_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/agent/tools`. */
function agentToolsDir(env: Env = process.env): string {
  return join(agentDir(env), AGENT_TOOLS_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/agent/mcps`. */
function agentMcpsDir(env: Env = process.env): string {
  return join(agentDir(env), AGENT_MCPS_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/agent/model-providers`. */
function agentModelProvidersDir(env: Env = process.env): string {
  return join(agentDir(env), AGENT_MODEL_PROVIDERS_DIR_NAME);
}

/**
 * Absolute path to the AGENT WORKSPACE base directory — the parent the
 * `.agent-workspace/` tree is created under. Honors `BASALT_AGENT_WORKSPACE_DIR`
 * (resolved against cwd if relative); otherwise defaults to {@link stateDir}, so
 * the workspace co-locates with platform state unless explicitly relocated.
 */
function agentWorkspaceBaseDir(env: Env = process.env): string {
  const override = env[AGENT_WORKSPACE_DIR_ENV_VAR];
  if (typeof override === 'string' && override.length > 0) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return stateDir(env);
}

/**
 * Absolute path to the workspace ROOT, `<AGENT_WORKSPACE_DIR>/.agent-workspace`.
 * `basalt init` creates this (and {@link agentWorkspaceSharedDir}); the
 * `@basalt/agent-workspace` package creates per-session subdirectories under it.
 */
function agentWorkspaceDir(env: Env = process.env): string {
  return join(agentWorkspaceBaseDir(env), AGENT_WORKSPACE_DIR_NAME);
}

/** Absolute path to `<workspace>/shared` — cross-session artifacts. */
function agentWorkspaceSharedDir(env: Env = process.env): string {
  return join(agentWorkspaceDir(env), AGENT_WORKSPACE_SHARED_DIR_NAME);
}

/** Absolute path to `<workspace>/sessions` — the parent of every session cwd. */
function agentWorkspaceSessionsDir(env: Env = process.env): string {
  return join(agentWorkspaceDir(env), AGENT_WORKSPACE_SESSIONS_DIR_NAME);
}

/**
 * Absolute path to one session's working directory,
 * `<workspace>/sessions/<id>`. `id` MUST already be validated (see `names.ts`) —
 * this only joins, so no traversal input reaches disk.
 */
function agentWorkspaceSessionDir(id: string, env: Env = process.env): string {
  return join(agentWorkspaceSessionsDir(env), id);
}

/**
 * Absolute path to a named entry under the shared dir,
 * `<workspace>/shared/<name>`. `name` MUST already be validated (see `names.ts`)
 * — this only joins.
 */
function agentWorkspaceSharedEntryDir(name: string, env: Env = process.env): string {
  return join(agentWorkspaceSharedDir(env), name);
}

/** Absolute path to `<STATE_DIR>/config/main.json`. */
function mainConfigFile(env: Env = process.env): string {
  return join(configDir(env), MAIN_CONFIG_FILE);
}

/** Absolute path to `<STATE_DIR>/config/model-providers`. */
function modelProvidersDir(env: Env = process.env): string {
  return join(configDir(env), MODEL_PROVIDERS_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/config/plugins`. */
function pluginsDir(env: Env = process.env): string {
  return join(configDir(env), PLUGINS_DIR_NAME);
}

/**
 * Absolute path to a model-provider config file, `.../model-providers/<name>.json`.
 * `name` MUST already be validated (see `names.ts`) — this only joins.
 */
function modelProviderFile(name: string, env: Env = process.env): string {
  return join(modelProvidersDir(env), `${name}.json`);
}

/**
 * Absolute path to a plugin config file, `.../plugins/<name>.json`.
 * `name` MUST already be validated (see `names.ts`) — this only joins.
 */
function pluginFile(name: string, env: Env = process.env): string {
  return join(pluginsDir(env), `${name}.json`);
}

/** Absolute path to `<STATE_DIR>/config/tools`. */
function toolsDir(env: Env = process.env): string {
  return join(configDir(env), TOOLS_DIR_NAME);
}

/** Absolute path to `<STATE_DIR>/config/mcp-servers`. */
function mcpServersDir(env: Env = process.env): string {
  return join(configDir(env), MCP_SERVERS_DIR_NAME);
}

/**
 * Absolute path to a tool config file, `.../tools/<name>.json`.
 * `name` MUST already be validated (see `names.ts`) — this only joins.
 */
function toolFile(name: string, env: Env = process.env): string {
  return join(toolsDir(env), `${name}.json`);
}

/**
 * Absolute path to an MCP-server config file, `.../mcp-servers/<name>.json`.
 * `name` MUST already be validated (see `names.ts`) — this only joins.
 */
function mcpServerFile(name: string, env: Env = process.env): string {
  return join(mcpServersDir(env), `${name}.json`);
}

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
};
