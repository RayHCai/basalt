import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isSecretField } from './secret-field.js';
import { collectSecretPaths } from './walk.js';
import {
  defineMcpServerConfig,
  defineModelProviderConfig,
  definePluginConfig,
  defineToolConfig,
  MainConfigSchema,
  McpServerConfigSchema,
  ModelProviderConfigSchema,
  PluginConfigSchema,
  ToolConfigSchema,
} from './schemas.js';

describe('MainConfigSchema', () => {
  it('fills every field from defaults when given an empty object', () => {
    const parsed = MainConfigSchema.parse({});
    expect(parsed).toEqual({
      telemetry: false,
      gateway: { timeoutMs: 30_000 },
    });
  });

  it('accepts a fully specified main config, including the optional gateway token', () => {
    const parsed = MainConfigSchema.parse({
      telemetry: true,
      gateway: {
        baseUrl: 'https://gw.example.com',
        timeoutMs: 5000,
        accessToken: { $secret: 'main.gateway.accessToken' },
      },
    });
    expect(parsed.gateway.baseUrl).toBe('https://gw.example.com');
    expect(parsed.telemetry).toBe(true);
  });

  it('is strict: rejects unknown top-level keys', () => {
    expect(() => MainConfigSchema.parse({ nope: 1 })).toThrow();
  });

  it('rejects a non-URL gateway baseUrl', () => {
    expect(() => MainConfigSchema.parse({ gateway: { baseUrl: 'not a url' } })).toThrow();
  });

  it('marks the gateway access token as a secret field', () => {
    const paths = collectSecretPaths(MainConfigSchema, {
      telemetry: false,
      gateway: { timeoutMs: 1, accessToken: { $secret: 'ref' } },
    });
    expect(paths).toContainEqual(['gateway', 'accessToken']);
  });
});

describe('ModelProviderConfigSchema', () => {
  it('defaults to enabled with an empty auth bag, no harness, and no models', () => {
    expect(ModelProviderConfigSchema.parse({})).toEqual({
      enabled: true,
      auth: {},
      defaultHeaders: {},
      models: [],
    });
  });

  it('accepts a models list and defaults each model to enabled', () => {
    const parsed = ModelProviderConfigSchema.parse({
      models: [{ name: 'claude-opus-4-8' }, { name: 'claude-haiku-4-5', enabled: false }],
    });
    expect(parsed.models).toEqual([
      { name: 'claude-opus-4-8', enabled: true },
      { name: 'claude-haiku-4-5', enabled: false },
    ]);
  });

  it('rejects a model with an empty name', () => {
    expect(() => ModelProviderConfigSchema.parse({ models: [{ name: '' }] })).toThrow();
  });

  it('accepts an apiKey in the auth bag carrying a secret marker', () => {
    const parsed = ModelProviderConfigSchema.parse({
      auth: { apiKey: { $secret: 'model-provider.anthropic.auth.apiKey' } },
    });
    expect((parsed.auth.apiKey as { $secret: string }).$secret).toBe(
      'model-provider.anthropic.auth.apiKey',
    );
  });

  it('accepts an oauth method with secret client credentials + tokens', () => {
    const parsed = ModelProviderConfigSchema.parse({
      auth: {
        oauth: {
          clientId: 'client-123',
          clientSecret: { $secret: 'ref-cs' },
          tokenUrl: 'https://auth.example.com/token',
          refreshToken: { $secret: 'ref-rt' },
        },
      },
    });
    expect(parsed.auth.oauth?.clientId).toBe('client-123');
    expect(parsed.auth.oauth?.scopes).toEqual([]);
  });

  it('accepts a public-client oauth with no clientSecret (PKCE / subscription token)', () => {
    const parsed = ModelProviderConfigSchema.parse({
      auth: {
        oauth: {
          clientId: 'client-123',
          tokenUrl: 'https://auth.example.com/token',
          refreshToken: { $secret: 'ref-rt' },
          scopes: ['user:inference'],
        },
      },
    });
    expect(parsed.auth.oauth?.clientId).toBe('client-123');
    expect(parsed.auth.oauth?.clientSecret).toBeUndefined();
  });

  it('accepts apiKey and oauth together in one auth bag', () => {
    const parsed = ModelProviderConfigSchema.parse({
      auth: {
        apiKey: { $secret: 'ref-key' },
        oauth: {
          clientId: 'c',
          clientSecret: { $secret: 'ref-cs' },
          tokenUrl: 'https://auth.example.com/token',
        },
      },
    });
    expect(parsed.auth.apiKey).toBeDefined();
    expect(parsed.auth.oauth).toBeDefined();
  });

  it('accepts a top-level 3rd-party harness with a command and secret env', () => {
    const parsed = ModelProviderConfigSchema.parse({
      harness: {
        command: 'claude',
        args: ['--json'],
        env: { ANTHROPIC_API_KEY: { $secret: 'ref-env' } },
      },
    });
    expect(parsed.harness?.command).toBe('claude');
  });

  it('finds every secret across the auth bag and harness', () => {
    const authPaths = collectSecretPaths(ModelProviderConfigSchema, {
      enabled: true,
      defaultHeaders: {},
      auth: {
        apiKey: { $secret: 'k' },
        oauth: {
          clientId: 'c',
          clientSecret: { $secret: 'a' },
          tokenUrl: 'https://x.example',
          refreshToken: { $secret: 'b' },
        },
      },
    });
    expect(authPaths).toContainEqual(['auth', 'apiKey']);
    expect(authPaths).toContainEqual(['auth', 'oauth', 'clientSecret']);
    expect(authPaths).toContainEqual(['auth', 'oauth', 'refreshToken']);

    const harnessPaths = collectSecretPaths(ModelProviderConfigSchema, {
      enabled: true,
      defaultHeaders: {},
      auth: {},
      harness: { command: 'x', env: { A: { $secret: 'r1' }, B: { $secret: 'r2' } } },
    });
    expect(harnessPaths).toContainEqual(['harness', 'env', 'A']);
    expect(harnessPaths).toContainEqual(['harness', 'env', 'B']);
  });

  it('is loose: preserves unknown keys so an SDK-extended file loads without loss', () => {
    const parsed = ModelProviderConfigSchema.parse({ enabled: true, sdkSpecific: { a: 1 } });
    expect((parsed as Record<string, unknown>)['sdkSpecific']).toEqual({ a: 1 });
  });

  it('is strict inside auth: rejects an unknown auth method key', () => {
    expect(() => ModelProviderConfigSchema.parse({ auth: { psychic: true } })).toThrow();
  });
});

describe('PluginConfigSchema', () => {
  it('defaults to enabled with empty settings', () => {
    expect(PluginConfigSchema.parse({})).toEqual({ enabled: true, settings: {} });
  });

  it('is loose: preserves unknown top-level keys', () => {
    const parsed = PluginConfigSchema.parse({ enabled: false, custom: 'x' });
    expect((parsed as Record<string, unknown>)['custom']).toBe('x');
  });
});

describe('ToolConfigSchema', () => {
  it('defaults to enabled', () => {
    expect(ToolConfigSchema.parse({})).toEqual({ enabled: true });
  });

  it('is loose: preserves unknown top-level keys', () => {
    const parsed = ToolConfigSchema.parse({ enabled: false, custom: 'x' });
    expect(parsed.enabled).toBe(false);
    expect((parsed as Record<string, unknown>)['custom']).toBe('x');
  });
});

describe('McpServerConfigSchema', () => {
  it('defaults to enabled', () => {
    expect(McpServerConfigSchema.parse({})).toEqual({ enabled: true });
  });

  it('is loose: preserves unknown top-level keys', () => {
    const parsed = McpServerConfigSchema.parse({ enabled: false, custom: 'x' });
    expect(parsed.enabled).toBe(false);
    expect((parsed as Record<string, unknown>)['custom']).toBe('x');
  });
});

describe('defineToolConfig', () => {
  it('returns the plain base schema when no extender is supplied', () => {
    expect(defineToolConfig().parse({})).toEqual(ToolConfigSchema.parse({}));
  });

  it('extends the base with SDK fields while keeping the enabled default', () => {
    const schema = defineToolConfig((base) => base.extend({ endpoint: z.url() }));
    const parsed = schema.parse({ endpoint: 'https://tool.example.com' });
    expect(parsed).toMatchObject({ enabled: true, endpoint: 'https://tool.example.com' });
  });

  it('lets an SDK add its own secret field, discoverable by the walker', () => {
    const schema = defineToolConfig((base, secret) => base.extend({ apiKey: secret() }));
    const field = (schema.def.shape as Record<string, z.ZodType | undefined>)['apiKey'];
    expect(isSecretField(field as z.ZodType)).toBe(true);
  });
});

describe('defineMcpServerConfig', () => {
  it('returns the plain base schema when no extender is supplied', () => {
    expect(defineMcpServerConfig().parse({})).toEqual(McpServerConfigSchema.parse({}));
  });

  it('extends the base with SDK fields while keeping the enabled default', () => {
    const schema = defineMcpServerConfig((base) => base.extend({ command: z.string() }));
    const parsed = schema.parse({ command: 'mcp-fs' });
    expect(parsed).toMatchObject({ enabled: true, command: 'mcp-fs' });
  });

  it('lets an SDK add its own secret field, discoverable by the walker', () => {
    const schema = defineMcpServerConfig((base, secret) =>
      base.extend({ env: z.record(z.string(), secret()) }),
    );
    const field = (schema.def.shape as Record<string, z.ZodType | undefined>)['env'];
    expect(field).toBeDefined();
  });
});

describe('defineModelProviderConfig', () => {
  it('extends the base with SDK fields while keeping base defaults + secret fields', () => {
    const schema = defineModelProviderConfig((base) =>
      base.extend({ model: z.string().default('claude-opus-4-8') }),
    );
    const parsed = schema.parse({ auth: {} });
    expect(parsed).toMatchObject({ enabled: true, model: 'claude-opus-4-8' });
  });

  it('lets an SDK add its own secret field, discoverable by the walker', () => {
    const schema = defineModelProviderConfig((base, secret) =>
      base.extend({ webhookSecret: secret() }),
    );
    const field = (schema.def.shape as Record<string, z.ZodType | undefined>)['webhookSecret'];
    expect(field).toBeDefined();
    expect(isSecretField(field as z.ZodType)).toBe(true);
  });

  it('returns the plain base schema when no extender is supplied', () => {
    expect(defineModelProviderConfig().parse({})).toEqual(ModelProviderConfigSchema.parse({}));
  });
});

describe('definePluginConfig', () => {
  it('replaces the settings schema with a typed one', () => {
    const schema = definePluginConfig(z.object({ repo: z.string(), token: z.string().optional() }));
    const parsed = schema.parse({ settings: { repo: 'owner/name' } });
    expect(parsed).toEqual({ enabled: true, settings: { repo: 'owner/name' } });
  });

  it('rejects settings that violate the typed schema', () => {
    const schema = definePluginConfig(z.object({ repo: z.string() }));
    expect(() => schema.parse({ settings: {} })).toThrow();
  });
});
