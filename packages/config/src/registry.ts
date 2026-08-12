import type { z } from 'zod';

import { assertValidName } from './names.js';
import {
  McpServerConfigSchema,
  ModelProviderConfigSchema,
  PluginConfigSchema,
  ToolConfigSchema,
} from './schemas.js';

/**
 * A per-store registry of refined section schemas. Model-provider and plugin
 * config files are LOOSE by default (so an unregistered reader round-trips them
 * without data loss), but an SDK that owns a section can bind a stricter schema
 * — adding typed fields, its own {@link secret} fields, or a narrowed `settings`
 * shape — before the store loads. The store then validates, resolves secrets,
 * and redacts against that schema instead of the base.
 *
 * Registration is by section name. An unregistered name falls back to the base
 * schema. Names are validated up front with the same allowlist used for file
 * paths, so a bad name is rejected here rather than at disk time.
 */
interface SchemaRegistry {
  /** Bind a refined schema for a named model provider (typically an SDK's). */
  registerModelProvider: (name: string, schema: z.ZodObject) => void;
  /** Bind a refined schema for a named plugin. */
  registerPlugin: (name: string, schema: z.ZodObject) => void;
  /** Bind a refined schema for a named tool. */
  registerTool: (name: string, schema: z.ZodObject) => void;
  /** Bind a refined schema for a named MCP server. */
  registerMcpServer: (name: string, schema: z.ZodObject) => void;
  /** The schema for a model provider — the registered one, or the base. */
  modelProviderSchema: (name: string) => z.ZodObject;
  /** The schema for a plugin — the registered one, or the base. */
  pluginSchema: (name: string) => z.ZodObject;
  /** The schema for a tool — the registered one, or the base. */
  toolSchema: (name: string) => z.ZodObject;
  /** The schema for an MCP server — the registered one, or the base. */
  mcpServerSchema: (name: string) => z.ZodObject;
}

/** Build an empty schema registry backed by the base model-provider/plugin schemas. */
function createSchemaRegistry(): SchemaRegistry {
  const modelProviders = new Map<string, z.ZodObject>();
  const plugins = new Map<string, z.ZodObject>();
  const tools = new Map<string, z.ZodObject>();
  const mcpServers = new Map<string, z.ZodObject>();

  return {
    registerModelProvider(name: string, schema: z.ZodObject): void {
      modelProviders.set(assertValidName(name), schema);
    },

    registerPlugin(name: string, schema: z.ZodObject): void {
      plugins.set(assertValidName(name), schema);
    },

    registerTool(name: string, schema: z.ZodObject): void {
      tools.set(assertValidName(name), schema);
    },

    registerMcpServer(name: string, schema: z.ZodObject): void {
      mcpServers.set(assertValidName(name), schema);
    },

    modelProviderSchema(name: string): z.ZodObject {
      return modelProviders.get(name) ?? ModelProviderConfigSchema;
    },

    pluginSchema(name: string): z.ZodObject {
      return plugins.get(name) ?? PluginConfigSchema;
    },

    toolSchema(name: string): z.ZodObject {
      return tools.get(name) ?? ToolConfigSchema;
    },

    mcpServerSchema(name: string): z.ZodObject {
      return mcpServers.get(name) ?? McpServerConfigSchema;
    },
  };
}

export { createSchemaRegistry, type SchemaRegistry };
