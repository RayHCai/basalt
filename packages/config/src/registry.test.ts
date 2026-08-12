import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createSchemaRegistry } from './registry.js';
import {
  McpServerConfigSchema,
  ModelProviderConfigSchema,
  PluginConfigSchema,
  ToolConfigSchema,
} from './schemas.js';
import { secret } from './secret-field.js';

describe('createSchemaRegistry', () => {
  it('falls back to the base schemas for unregistered names', () => {
    const registry = createSchemaRegistry();
    expect(registry.modelProviderSchema('unknown')).toBe(ModelProviderConfigSchema);
    expect(registry.pluginSchema('unknown')).toBe(PluginConfigSchema);
    expect(registry.toolSchema('unknown')).toBe(ToolConfigSchema);
    expect(registry.mcpServerSchema('unknown')).toBe(McpServerConfigSchema);
  });

  it('returns a registered model-provider schema for its name', () => {
    const registry = createSchemaRegistry();
    const schema = ModelProviderConfigSchema.extend({ model: z.string() });
    registry.registerModelProvider('anthropic', schema);
    expect(registry.modelProviderSchema('anthropic')).toBe(schema);
    // Other names still get the base.
    expect(registry.modelProviderSchema('openai')).toBe(ModelProviderConfigSchema);
  });

  it('returns a registered plugin schema for its name', () => {
    const registry = createSchemaRegistry();
    const schema = PluginConfigSchema.extend({ settings: z.object({ repo: z.string() }) });
    registry.registerPlugin('github', schema);
    expect(registry.pluginSchema('github')).toBe(schema);
  });

  it('returns a registered tool schema for its name', () => {
    const registry = createSchemaRegistry();
    const schema = ToolConfigSchema.extend({ endpoint: z.url() });
    registry.registerTool('search', schema);
    expect(registry.toolSchema('search')).toBe(schema);
    expect(registry.toolSchema('other')).toBe(ToolConfigSchema);
  });

  it('returns a registered MCP-server schema for its name', () => {
    const registry = createSchemaRegistry();
    const schema = McpServerConfigSchema.extend({ command: z.string() });
    registry.registerMcpServer('filesystem', schema);
    expect(registry.mcpServerSchema('filesystem')).toBe(schema);
    expect(registry.mcpServerSchema('other')).toBe(McpServerConfigSchema);
  });

  it('validates the section name before registering (path-traversal guard)', () => {
    const registry = createSchemaRegistry();
    expect(() => registry.registerModelProvider('../evil', ModelProviderConfigSchema)).toThrow(
      /Invalid config section name/u,
    );
    expect(() => registry.registerPlugin('Bad Name', PluginConfigSchema)).toThrow();
  });

  it('lets a registered schema carry SDK-specific secret fields', () => {
    const registry = createSchemaRegistry();
    const schema = ModelProviderConfigSchema.extend({ webhookSecret: secret() });
    registry.registerModelProvider('stripe', schema);
    // Round-trips a marker for the SDK secret field.
    const parsed = registry.modelProviderSchema('stripe').parse({
      webhookSecret: { $secret: 'ref' },
    });
    expect((parsed as { webhookSecret: { $secret: string } }).webhookSecret.$secret).toBe('ref');
  });

  it('overwrites a prior registration for the same name (last wins)', () => {
    const registry = createSchemaRegistry();
    const first = ModelProviderConfigSchema.extend({ a: z.string() });
    const second = ModelProviderConfigSchema.extend({ b: z.string() });
    registry.registerModelProvider('x', first);
    registry.registerModelProvider('x', second);
    expect(registry.modelProviderSchema('x')).toBe(second);
  });
});
