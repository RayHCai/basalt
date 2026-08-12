import { access, mkdir } from 'node:fs/promises';

import type { SecretStore } from '@basalt/secrets';

import {
  agentDir,
  agentMcpsDir,
  agentModelProvidersDir,
  agentToolsDir,
  agentWorkspaceDir,
  agentWorkspaceSharedDir,
  configDir,
  mainConfigFile,
  secretsDir,
  stateDir,
} from './paths.js';
import type { Env } from './paths.js';
import { openSecretStore } from './secret-store.js';
import { createConfigStore } from './store.js';
import type { ConfigStore } from './store.js';

/**
 * High-level `basalt init` entry point: prepare a usable STATE_DIR and return a
 * loaded {@link ConfigStore} plus a summary of what was set up. The runtime calls
 * this for the `initConfig` request; the CLI's `basalt init` ultimately lands
 * here. On a fresh machine this establishes the whole runtime state layout:
 *
 *   <STATE_DIR>/            (created if absent — see the TODO on `stateDir`)
 *     agent/                installed agent code (loaded at runtime)
 *       tools/              tool implementations (loaded by the tools handler)
 *       mcps/               MCP servers (loaded by the MCP handler)
 *       model-providers/    model-provider harnesses
 *     config/               seeded main.json + per-kind section dirs
 *     secrets/              encrypted store + 0600 master key
 *
 *   <AGENT_WORKSPACE_DIR>/  (defaults to STATE_DIR; relocate via env var)
 *     .agent-workspace/     agent-run working tree (session cwds live here)
 *       shared/             cross-session artifacts
 *
 * It (1) creates/updates STATE_DIR and the `agent/` code tree, (2) sets up config
 * (seeding `main.json` if absent), (3) sets up secrets (opening the store, which
 * resolves/generates the master key), and (4) creates the `.agent-workspace/`
 * tree (the workspace root + its `shared/` child) a spawned session's cwd lives
 * under. Deliberately non-interactive for now
 * — prompt-driven setup
 * (asking for a gateway token, adding a model provider) can layer on top by
 * calling the returned store's setters, but the safe default is idempotent:
 * running `basalt init` twice never destroys existing config.
 */
interface InitConfigOptions {
  /** Environment map (state-dir resolution + main env overlay). */
  env?: Env;
  /**
   * Secret store to route sensitive values through. If omitted, one is opened
   * at `<STATE_DIR>/secrets` — the standard location. Injectable for tests and
   * for a trusted broker that owns a single shared store.
   */
  secrets?: SecretStore;
}

/** What {@link initConfig} did, for the CLI to report back to the user. */
interface InitConfigResult {
  /** The loaded, ready-to-use config store. */
  store: ConfigStore;
  /** `true` if this run created `main.json`; `false` if it already existed. */
  seeded: boolean;
  /** Absolute path to the state directory (the root holding config + secrets). */
  stateDir: string;
  /** Absolute path to the config directory. */
  configDir: string;
  /** Absolute path to the secrets directory. */
  secretsDir: string;
  /** Absolute path to the agent code directory (`<STATE_DIR>/agent`). */
  agentDir: string;
  /** Absolute path to the installed-tools directory (`agent/tools`). */
  agentToolsDir: string;
  /** Absolute path to the installed-MCP-servers directory (`agent/mcps`). */
  agentMcpsDir: string;
  /** Absolute path to the model-provider-harness directory (`agent/model-providers`). */
  agentModelProvidersDir: string;
  /** Absolute path to the agent-workspace root (`<AGENT_WORKSPACE_DIR>/.agent-workspace`). */
  agentWorkspaceDir: string;
  /** Absolute path to the workspace's shared, cross-session directory (`.agent-workspace/shared`). */
  agentWorkspaceSharedDir: string;
  /** Absolute path to the seeded/loaded main config file. */
  mainConfigPath: string;
  /** Names of model-provider sections found. */
  modelProviders: string[];
  /** Names of plugin sections found. */
  plugins: string[];
  /** Names of tool sections found. */
  tools: string[];
  /** Names of MCP-server sections found. */
  mcpServers: string[];
}

/** Run the config initialization flow. See {@link InitConfigOptions}. */
async function initConfig(options: InitConfigOptions = {}): Promise<InitConfigResult> {
  const env = options.env ?? process.env;

  // 1. Create/update STATE_DIR — the root every other package roots under. Its
  // children (config/, secrets/) are also created on demand by their own atomic
  // writers, but establishing the root up front makes `basalt init` a single
  // clear "here is your state directory" step even before anything is written.
  const root = stateDir(env);
  await mkdir(root, { recursive: true, mode: 0o700 });

  // 2. Agent code tree — where the tools/MCP/model-provider handlers install and
  // load implementations from (distinct from config/, which only describes them).
  // Unlike config's section dirs (created lazily on first write), these must exist
  // up front so a fresh machine has somewhere to install into. mkdir -p is
  // idempotent, so a second `basalt init` leaves an existing tree untouched.
  const agentToolsPath = agentToolsDir(env);
  const agentMcpsPath = agentMcpsDir(env);
  const agentModelProvidersPath = agentModelProvidersDir(env);
  await Promise.all([
    mkdir(agentToolsPath, { recursive: true, mode: 0o700 }),
    mkdir(agentMcpsPath, { recursive: true, mode: 0o700 }),
    mkdir(agentModelProvidersPath, { recursive: true, mode: 0o700 }),
  ]);

  // 3. Agent workspace — the `.agent-workspace/` tree a spawned session's cwd
  // lives under. Its base defaults to STATE_DIR but can be relocated OUTSIDE it
  // (BASALT_AGENT_WORKSPACE_DIR), so mkdir -p the workspace root and its shared/
  // child directly rather than assuming the root already exists. Session cwds
  // (sessions/<id>) are NOT created here — `@basalt/agent-workspace` makes those
  // per-run. Idempotent, so a second `basalt init` leaves an existing tree alone.
  const agentWorkspacePath = agentWorkspaceDir(env);
  const agentWorkspaceSharedPath = agentWorkspaceSharedDir(env);
  await mkdir(agentWorkspaceSharedPath, { recursive: true, mode: 0o700 });

  // 4. Secrets — opening the store resolves (or generates) the 0600 master key
  // under <STATE_DIR>/secrets, enforcing the trust gate up front. Config owns
  // the location and the single shared store instance.
  const secrets = options.secrets ?? (await openSecretStore(env));

  const mainPath = mainConfigFile(env);
  // Detect "already seeded" BEFORE init writes the template, so the report is
  // accurate. init() itself is idempotent (only writes when absent).
  const existedBefore = await fileExists(mainPath);

  // 5. Config — seed main.json if absent, then load everything into cache.
  const store = await createConfigStore({ env, secrets });
  await store.init();
  await store.load();

  return {
    store,
    seeded: !existedBefore,
    stateDir: root,
    configDir: configDir(env),
    secretsDir: secretsDir(env),
    agentDir: agentDir(env),
    agentToolsDir: agentToolsPath,
    agentMcpsDir: agentMcpsPath,
    agentModelProvidersDir: agentModelProvidersPath,
    agentWorkspaceDir: agentWorkspacePath,
    agentWorkspaceSharedDir: agentWorkspaceSharedPath,
    mainConfigPath: mainPath,
    modelProviders: store.modelProviders(),
    plugins: store.plugins(),
    tools: store.tools(),
    mcpServers: store.mcpServers(),
  };
}

/** `true` if a path is readable/exists. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The per-name config kinds `basalt config create-*` can seed. */
type CreatableKind = 'model-provider' | 'plugin' | 'tool' | 'mcp-server';

/** Options for {@link createConfigSection}. Same wiring seams as {@link initConfig}. */
interface CreateConfigSectionOptions {
  /** Environment map (state-dir resolution). */
  env?: Env;
  /** Secret store to route through. If omitted, one is opened at `<STATE_DIR>/secrets`. */
  secrets?: SecretStore;
}

/** What {@link createConfigSection} did, for the CLI to report back. */
interface CreateConfigSectionResult {
  /** The kind of section created. */
  kind: CreatableKind;
  /** The section name. */
  name: string;
  /** Absolute path to the (created or pre-existing) section file, ready to edit. */
  path: string;
}

/**
 * High-level `basalt config create-<kind> <name>` entry point: open a loaded
 * config store, seed the named section from its base template (registering it),
 * and return the file path so the caller can print it for hand-editing.
 * Idempotent — an existing section is left untouched and its path returned.
 */
async function createConfigSection(
  kind: CreatableKind,
  name: string,
  options: CreateConfigSectionOptions = {},
): Promise<CreateConfigSectionResult> {
  const env = options.env ?? process.env;
  const secrets = options.secrets ?? (await openSecretStore(env));

  const store = await createConfigStore({ env, secrets });
  await store.init();
  await store.load();

  const create = {
    'model-provider': store.createModelProvider,
    plugin: store.createPlugin,
    tool: store.createTool,
    'mcp-server': store.createMcpServer,
  }[kind];
  const path = await create(name);

  return { kind, name, path };
}

export {
  createConfigSection,
  type CreatableKind,
  type CreateConfigSectionOptions,
  type CreateConfigSectionResult,
  initConfig,
  type InitConfigOptions,
  type InitConfigResult,
};
