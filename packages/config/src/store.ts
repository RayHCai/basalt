import type { SecretStore } from '@basalt/secrets';
import type { z } from 'zod';

import defaultMainConfig from './schemas/defaults/main.json' with { type: 'json' };
import { listSectionNames } from './io.js';
import type { JsonObject } from './io.js';
import { assertValidName } from './names.js';
import {
  configDir,
  mainConfigFile,
  mcpServerFile,
  mcpServersDir,
  modelProviderFile,
  modelProvidersDir,
  pluginFile,
  pluginsDir,
  toolFile,
  toolsDir,
} from './paths.js';
import type { Env } from './paths.js';
import { createSchemaRegistry } from './registry.js';
import type { SchemaRegistry } from './registry.js';
import { MainConfigSchema } from './schemas.js';
import type {
  MainConfig,
  McpServerConfig,
  ModelProviderConfig,
  PluginConfig,
  ToolConfig,
} from './schemas.js';
import type { PatchInput, RedactSecrets, ResolveSecrets } from './secret-field.js';
import {
  deleteSection,
  mergeSection,
  persistSection,
  readSection,
  redactSection,
  resolveSection,
  sealSection,
  writeSection,
} from './sections.js';

/** Env var overlaying the gateway access token onto main config (read-only). */
const GATEWAY_TOKEN_ENV_VAR = 'BASALT_GATEWAY_ACCESS_TOKEN';

/** Env var overlaying the gateway base URL onto main config (read-only). */
const GATEWAY_BASE_URL_ENV_VAR = 'BASALT_GATEWAY_BASE_URL';

/** Options for {@link createConfigStore}. */
interface ConfigStoreOptions {
  /** Environment map (state-dir + overlay resolution). Defaults to `process.env`. */
  env?: Env;
  /**
   * The secret store sensitive values route through. Required — config does not
   * open one itself, so the trusted broker owns a single store instance and can
   * decide where it lives / whether the context is trusted.
   */
  secrets: SecretStore;
}

/**
 * The public config surface. Two-phase, mirroring `@basalt/secrets`:
 *   1. `await init()` — seed the base template (idempotent).
 *   2. `await load()` — validate every section into an in-memory cache.
 * After `load()`, getters are SYNCHRONOUS. Mutations are async (they persist and
 * re-seal secrets). Secret-bearing fields are returned as live `Secret` boxes
 * from getters, as the redaction placeholder from `redacted*`, and accepted as
 * plaintext/`Secret` by setters.
 */
interface ConfigStore {
  /** Seed `main.json` from the base template if absent. Idempotent. */
  init: () => Promise<void>;
  /** Load + validate every section into cache. Call once before any getter. */
  load: () => Promise<void>;

  /** The resolved main config, secrets as live {@link Secret} boxes. */
  main: () => ResolveSecrets<MainConfig>;
  /** A resolved model-provider config by name, or `undefined` if absent. */
  modelProvider: (name: string) => ResolveSecrets<ModelProviderConfig> | undefined;
  /** A resolved plugin config by name, or `undefined` if absent. */
  plugin: (name: string) => ResolveSecrets<PluginConfig> | undefined;
  /** A resolved tool config by name, or `undefined` if absent. */
  tool: (name: string) => ResolveSecrets<ToolConfig> | undefined;
  /** A resolved MCP-server config by name, or `undefined` if absent. */
  mcpServer: (name: string) => ResolveSecrets<McpServerConfig> | undefined;
  /** Names of all configured model providers. */
  modelProviders: () => string[];
  /** Names of all configured plugins. */
  plugins: () => string[];
  /** Names of all configured tools. */
  tools: () => string[];
  /** Names of all configured MCP servers. */
  mcpServers: () => string[];

  /** Merge a partial main config over the current one, sealing any secrets. */
  setMain: (patch: PatchInput<MainConfig>) => Promise<void>;
  /**
   * Create a model-provider section from the base template, register it, and
   * return the absolute path to its config file so the caller can edit the rest.
   * Idempotent: if the section already exists, its path is returned unchanged.
   */
  createModelProvider: (name: string) => Promise<string>;
  /** Create a plugin section from the base template; see {@link createModelProvider}. */
  createPlugin: (name: string) => Promise<string>;
  /** Create a tool section from the base template; see {@link createModelProvider}. */
  createTool: (name: string) => Promise<string>;
  /** Create an MCP-server section from the base template; see {@link createModelProvider}. */
  createMcpServer: (name: string) => Promise<string>;
  /** Delete a model-provider section and prune its secrets. */
  deleteModelProvider: (name: string) => Promise<boolean>;
  /** Delete a plugin section and prune its secrets. */
  deletePlugin: (name: string) => Promise<boolean>;
  /** Delete a tool section and prune its secrets. */
  deleteTool: (name: string) => Promise<boolean>;
  /** Delete an MCP-server section and prune its secrets. */
  deleteMcpServer: (name: string) => Promise<boolean>;

  /** A display-safe view of main config: secrets shown as `[redacted]`. */
  redactedMain: () => RedactSecrets<MainConfig>;
  /** A display-safe view of a model-provider section, or `undefined` if absent. */
  redactedModelProvider: (name: string) => RedactSecrets<ModelProviderConfig> | undefined;
  /** A display-safe view of a plugin section, or `undefined` if absent. */
  redactedPlugin: (name: string) => RedactSecrets<PluginConfig> | undefined;
  /** A display-safe view of a tool section, or `undefined` if absent. */
  redactedTool: (name: string) => RedactSecrets<ToolConfig> | undefined;
  /** A display-safe view of an MCP-server section, or `undefined` if absent. */
  redactedMcpServer: (name: string) => RedactSecrets<McpServerConfig> | undefined;

  /** Bind a refined model-provider schema for a name (SDKs call before load). */
  registerModelProvider: (name: string, schema: z.ZodObject) => void;
  /** Bind a refined plugin schema for a name (SDKs call before load). */
  registerPlugin: (name: string, schema: z.ZodObject) => void;
  /** Bind a refined tool schema for a name (SDKs call before load). */
  registerTool: (name: string, schema: z.ZodObject) => void;
  /** Bind a refined MCP-server schema for a name (SDKs call before load). */
  registerMcpServer: (name: string, schema: z.ZodObject) => void;
}

/**
 * Open a config store. Resolves nothing eagerly beyond wiring; call `init()`
 * then `load()`. The provided {@link SecretStore} is where sensitive fields are
 * sealed/opened.
 */
// oxlint-disable-next-line require-await -- async to lock in the two-phase contract; wiring is sync today
async function createConfigStore(options: ConfigStoreOptions): Promise<ConfigStore> {
  const env = options.env ?? process.env;
  const { secrets } = options;
  const registry: SchemaRegistry = createSchemaRegistry();

  // Populated by load(); a getter before load() is a programming error.
  // oxlint-disable-next-line init-declarations
  let mainStored: JsonObject | undefined;
  const modelProviderStored = new Map<string, JsonObject>();
  const pluginStored = new Map<string, JsonObject>();
  const toolStored = new Map<string, JsonObject>();
  const mcpServerStored = new Map<string, JsonObject>();
  let loaded = false;

  // Monotonic per-store counter making each atomic-write temp file unique, so
  // concurrent writes in one process never collide on the temp name.
  let writeSeq = 0;
  function nextSuffix(): string {
    writeSeq += 1;
    return `${process.pid.toString()}.${writeSeq.toString()}`;
  }

  function assertLoaded(): void {
    if (!loaded) {
      throw new Error('Config store used before load(); call await store.load() first.');
    }
  }

  /** Build the read-only env overlay for main config (secret token + base URL). */
  function mainEnvOverlay(): JsonObject {
    const gateway: JsonObject = {};
    const token = env[GATEWAY_TOKEN_ENV_VAR];
    if (typeof token === 'string' && token.length > 0) {
      // A plaintext token; sealSection turns it into a marker on load.
      gateway['accessToken'] = token;
    }
    const baseUrl = env[GATEWAY_BASE_URL_ENV_VAR];
    if (typeof baseUrl === 'string' && baseUrl.length > 0) {
      gateway['baseUrl'] = baseUrl;
    }
    return Object.keys(gateway).length > 0 ? { gateway } : {};
  }

  /** Load, validate, and cache every model-provider section. */
  async function loadModelProviders(): Promise<void> {
    modelProviderStored.clear();
    const names = await listSectionNames(modelProvidersDir(env));
    const loadedSections = await Promise.all(
      names.map(async (name) => ({
        name,
        value: await readSection(registry.modelProviderSchema(name), modelProviderFile(name, env)),
      })),
    );
    for (const { name, value } of loadedSections) {
      if (value !== undefined) {
        modelProviderStored.set(name, value);
      }
    }
  }

  /** Load, validate, and cache every plugin section. */
  async function loadPlugins(): Promise<void> {
    pluginStored.clear();
    const names = await listSectionNames(pluginsDir(env));
    const loadedSections = await Promise.all(
      names.map(async (name) => ({
        name,
        value: await readSection(registry.pluginSchema(name), pluginFile(name, env)),
      })),
    );
    for (const { name, value } of loadedSections) {
      if (value !== undefined) {
        pluginStored.set(name, value);
      }
    }
  }

  /** Load, validate, and cache every tool section. */
  async function loadTools(): Promise<void> {
    toolStored.clear();
    const names = await listSectionNames(toolsDir(env));
    const loadedSections = await Promise.all(
      names.map(async (name) => ({
        name,
        value: await readSection(registry.toolSchema(name), toolFile(name, env)),
      })),
    );
    for (const { name, value } of loadedSections) {
      if (value !== undefined) {
        toolStored.set(name, value);
      }
    }
  }

  /** Load, validate, and cache every MCP-server section. */
  async function loadMcpServers(): Promise<void> {
    mcpServerStored.clear();
    const names = await listSectionNames(mcpServersDir(env));
    const loadedSections = await Promise.all(
      names.map(async (name) => ({
        name,
        value: await readSection(registry.mcpServerSchema(name), mcpServerFile(name, env)),
      })),
    );
    for (const { name, value } of loadedSections) {
      if (value !== undefined) {
        mcpServerStored.set(name, value);
      }
    }
  }

  /**
   * Seed a per-name section from its (schema-defaulted) base template, register
   * it in the in-memory cache, and return the absolute path to its file so the
   * caller can hand-edit the rest. Idempotent: an already-present section is left
   * untouched and its path returned. The base template carries no secrets, so
   * this writes the validated document directly — no sealing/pruning needed.
   */
  async function createSection(
    schema: z.ZodObject,
    cache: Map<string, JsonObject>,
    dir: string,
    path: string,
    name: string,
  ): Promise<string> {
    assertLoaded();
    assertValidName(name);
    if (cache.has(name)) {
      return path;
    }
    const seeded = schema.parse({}) as JsonObject;
    await writeSection(dir, path, seeded, nextSuffix());
    cache.set(name, seeded);
    return path;
  }

  const store: ConfigStore = {
    async init(): Promise<void> {
      const path = mainConfigFile(env);
      if ((await readSection(MainConfigSchema, path)) === undefined) {
        // Seed from the checked-in base template, validated + written atomically.
        const seeded = MainConfigSchema.parse(defaultMainConfig) as JsonObject;
        await writeSection(configDir(env), path, seeded, nextSuffix());
      }
    },

    async load(): Promise<void> {
      // Main: template/live-file < env overlay, then seal (env token → marker)
      // and validate. sealSection never writes main.json, so the overlay stays
      // process-local and is not persisted.
      const liveMain = (await readSection(MainConfigSchema, mainConfigFile(env))) ?? {};
      const overlaid = mergeSection(MainConfigSchema, liveMain, mainEnvOverlay());
      mainStored = await sealSection(secrets, MainConfigSchema, 'main', undefined, overlaid);

      await loadModelProviders();
      await loadPlugins();
      await loadTools();
      await loadMcpServers();

      loaded = true;
    },

    main(): ResolveSecrets<MainConfig> {
      assertLoaded();
      return resolveSection(
        secrets,
        MainConfigSchema,
        mainStored ?? {},
      ) as ResolveSecrets<MainConfig>;
    },

    modelProvider(name: string): ResolveSecrets<ModelProviderConfig> | undefined {
      assertLoaded();
      const stored = modelProviderStored.get(name);
      return stored === undefined
        ? undefined
        : (resolveSection(
            secrets,
            registry.modelProviderSchema(name),
            stored,
          ) as ResolveSecrets<ModelProviderConfig>);
    },

    plugin(name: string): ResolveSecrets<PluginConfig> | undefined {
      assertLoaded();
      const stored = pluginStored.get(name);
      return stored === undefined
        ? undefined
        : (resolveSection(
            secrets,
            registry.pluginSchema(name),
            stored,
          ) as ResolveSecrets<PluginConfig>);
    },

    tool(name: string): ResolveSecrets<ToolConfig> | undefined {
      assertLoaded();
      const stored = toolStored.get(name);
      return stored === undefined
        ? undefined
        : (resolveSection(
            secrets,
            registry.toolSchema(name),
            stored,
          ) as ResolveSecrets<ToolConfig>);
    },

    mcpServer(name: string): ResolveSecrets<McpServerConfig> | undefined {
      assertLoaded();
      const stored = mcpServerStored.get(name);
      return stored === undefined
        ? undefined
        : (resolveSection(
            secrets,
            registry.mcpServerSchema(name),
            stored,
          ) as ResolveSecrets<McpServerConfig>);
    },

    modelProviders(): string[] {
      assertLoaded();
      return [...modelProviderStored.keys()];
    },

    plugins(): string[] {
      assertLoaded();
      return [...pluginStored.keys()];
    },

    tools(): string[] {
      assertLoaded();
      return [...toolStored.keys()];
    },

    mcpServers(): string[] {
      assertLoaded();
      return [...mcpServerStored.keys()];
    },

    async setMain(patch: PatchInput<MainConfig>): Promise<void> {
      assertLoaded();
      const merged = mergeSection(MainConfigSchema, mainStored, patch);
      mainStored = await persistSection(
        secrets,
        MainConfigSchema,
        'main',
        undefined,
        configDir(env),
        mainConfigFile(env),
        mainStored,
        merged,
        nextSuffix(),
      );
    },

    createModelProvider(name: string): Promise<string> {
      return createSection(
        registry.modelProviderSchema(name),
        modelProviderStored,
        modelProvidersDir(env),
        modelProviderFile(name, env),
        name,
      );
    },

    createPlugin(name: string): Promise<string> {
      return createSection(
        registry.pluginSchema(name),
        pluginStored,
        pluginsDir(env),
        pluginFile(name, env),
        name,
      );
    },

    createTool(name: string): Promise<string> {
      return createSection(
        registry.toolSchema(name),
        toolStored,
        toolsDir(env),
        toolFile(name, env),
        name,
      );
    },

    createMcpServer(name: string): Promise<string> {
      return createSection(
        registry.mcpServerSchema(name),
        mcpServerStored,
        mcpServersDir(env),
        mcpServerFile(name, env),
        name,
      );
    },

    async deleteModelProvider(name: string): Promise<boolean> {
      assertLoaded();
      assertValidName(name);
      const stored = modelProviderStored.get(name);
      if (stored === undefined) {
        return false;
      }
      await deleteSection(
        secrets,
        registry.modelProviderSchema(name),
        modelProviderFile(name, env),
        stored,
      );
      modelProviderStored.delete(name);
      return true;
    },

    async deletePlugin(name: string): Promise<boolean> {
      assertLoaded();
      assertValidName(name);
      const stored = pluginStored.get(name);
      if (stored === undefined) {
        return false;
      }
      await deleteSection(secrets, registry.pluginSchema(name), pluginFile(name, env), stored);
      pluginStored.delete(name);
      return true;
    },

    async deleteTool(name: string): Promise<boolean> {
      assertLoaded();
      assertValidName(name);
      const stored = toolStored.get(name);
      if (stored === undefined) {
        return false;
      }
      await deleteSection(secrets, registry.toolSchema(name), toolFile(name, env), stored);
      toolStored.delete(name);
      return true;
    },

    async deleteMcpServer(name: string): Promise<boolean> {
      assertLoaded();
      assertValidName(name);
      const stored = mcpServerStored.get(name);
      if (stored === undefined) {
        return false;
      }
      await deleteSection(
        secrets,
        registry.mcpServerSchema(name),
        mcpServerFile(name, env),
        stored,
      );
      mcpServerStored.delete(name);
      return true;
    },

    redactedMain(): RedactSecrets<MainConfig> {
      assertLoaded();
      return redactSection(MainConfigSchema, mainStored ?? {}) as RedactSecrets<MainConfig>;
    },

    redactedModelProvider(name: string): RedactSecrets<ModelProviderConfig> | undefined {
      assertLoaded();
      const stored = modelProviderStored.get(name);
      return stored === undefined
        ? undefined
        : (redactSection(
            registry.modelProviderSchema(name),
            stored,
          ) as RedactSecrets<ModelProviderConfig>);
    },

    redactedPlugin(name: string): RedactSecrets<PluginConfig> | undefined {
      assertLoaded();
      const stored = pluginStored.get(name);
      return stored === undefined
        ? undefined
        : (redactSection(registry.pluginSchema(name), stored) as RedactSecrets<PluginConfig>);
    },

    redactedTool(name: string): RedactSecrets<ToolConfig> | undefined {
      assertLoaded();
      const stored = toolStored.get(name);
      return stored === undefined
        ? undefined
        : (redactSection(registry.toolSchema(name), stored) as RedactSecrets<ToolConfig>);
    },

    redactedMcpServer(name: string): RedactSecrets<McpServerConfig> | undefined {
      assertLoaded();
      const stored = mcpServerStored.get(name);
      return stored === undefined
        ? undefined
        : (redactSection(registry.mcpServerSchema(name), stored) as RedactSecrets<McpServerConfig>);
    },

    registerModelProvider(name: string, schema: z.ZodObject): void {
      registry.registerModelProvider(name, schema);
    },

    registerPlugin(name: string, schema: z.ZodObject): void {
      registry.registerPlugin(name, schema);
    },

    registerTool(name: string, schema: z.ZodObject): void {
      registry.registerTool(name, schema);
    },

    registerMcpServer(name: string, schema: z.ZodObject): void {
      registry.registerMcpServer(name, schema);
    },
  };

  return store;
}

export { type ConfigStore, type ConfigStoreOptions, createConfigStore };
