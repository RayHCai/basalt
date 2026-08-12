import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretStore, isSecret } from '@basalt/secrets';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { REDACTED } from './secret-field.js';
import { createConfigStore } from './store.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Build a config store rooted at the temp state dir, with a real secret store. */
async function openStore() {
  const env = { BASALT_STATE_DIR: dir };
  const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
  const store = await createConfigStore({ env, secrets });
  await store.init();
  await store.load();
  return { store, secrets, env };
}

describe('createConfigStore lifecycle', () => {
  it('init seeds a valid main.json from the base template, idempotently', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const store = await createConfigStore({ env, secrets });

    await store.init();
    const path = join(dir, 'config', 'main.json');
    const first = await readFile(path, 'utf8');
    expect(JSON.parse(first)).toMatchObject({ telemetry: false });

    // A second init must not clobber an existing file.
    await writeFile(path, JSON.stringify({ telemetry: true, gateway: {} }));
    await store.init();
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ telemetry: true });
  });

  it('load makes sync getters available and returns defaults for absent sections', async () => {
    const { store } = await openStore();
    expect(store.main().telemetry).toBe(false);
    expect(store.modelProviders()).toEqual([]);
    expect(store.plugins()).toEqual([]);
    expect(store.tools()).toEqual([]);
    expect(store.mcpServers()).toEqual([]);
  });

  it('throws if a getter is used before load', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const store = await createConfigStore({ env, secrets });
    expect(() => store.main()).toThrow(/load\(\)/u);
  });
});

describe('main config precedence + validation', () => {
  it('overlays the environment for the gateway token/base url, re-validated', async () => {
    const env = {
      BASALT_STATE_DIR: dir,
      BASALT_GATEWAY_BASE_URL: 'https://env.example.com',
    };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const store = await createConfigStore({ env, secrets });
    await store.init();
    await store.load();
    expect(store.main().gateway.baseUrl).toBe('https://env.example.com');
  });

  it('rejects an invalid env overlay value (bad URL) on load', async () => {
    const env = { BASALT_STATE_DIR: dir, BASALT_GATEWAY_BASE_URL: 'not a url' };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const store = await createConfigStore({ env, secrets });
    await store.init();
    await expect(store.load()).rejects.toThrow();
  });

  it('rejects a malformed live main.json on load', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    await mkdir(join(dir, 'config'), { recursive: true });
    await writeFile(join(dir, 'config', 'main.json'), JSON.stringify({ telemetry: 'nonsense' }));
    const store = await createConfigStore({ env, secrets });
    await expect(store.load()).rejects.toThrow();
  });
});

describe('secret pass-through (the whole point)', () => {
  it('setMain seals a plaintext gateway token into @basalt/secrets and stores only a marker on disk', async () => {
    const { store, secrets, env } = await openStore();

    await store.setMain({ gateway: { accessToken: 'sk-live-SUPERSECRET' } });

    // The plaintext is NOWHERE in the config file.
    const raw = await readFile(join(dir, 'config', 'main.json'), 'utf8');
    expect(raw).not.toContain('sk-live-SUPERSECRET');
    expect(raw).toContain('$secret');

    // It lives, encrypted, in the secret store — the store file has no plaintext.
    const secretsRaw = await readFile(join(dir, 'secrets', 'secrets.json'), 'utf8');
    expect(secretsRaw).not.toContain('sk-live-SUPERSECRET');
    expect(secrets.list().length).toBe(1);

    // Reloading resolves it back to a live Secret.
    const reopened = await createConfigStore({ env, secrets });
    await reopened.load();
    const token = reopened.main().gateway.accessToken;
    expect(isSecret(token)).toBe(true);
    expect(token?.expose()).toBe('sk-live-SUPERSECRET');
  });

  it('redactedMain shows the placeholder, never the secret or its ref', async () => {
    const { store } = await openStore();
    await store.setMain({ gateway: { accessToken: 'sk-live-SUPERSECRET' } });
    const redacted = store.redactedMain();
    expect(redacted.gateway.accessToken).toBe(REDACTED);
    expect(JSON.stringify(redacted)).not.toContain('sk-live-SUPERSECRET');
    expect(JSON.stringify(redacted)).not.toContain('$secret');
  });

  it('prunes secrets a deleted section referenced (hand-edited marker on disk)', async () => {
    // create* seeds only a shell, so to exercise delete-prunes-secrets we set up
    // a section that references a secret the way a future secret-setting path (or
    // a hand edit) would: a `{ $secret }` marker on disk + the sealed value in the
    // secret store. The ref/store-name derivation mirrors secrets-bridge.
    const { secrets, env } = await openStore();
    const ref = 'model-provider.anthropic#auth.apiKey';
    const storeName = `cfg-${createHash('sha256').update(ref, 'utf8').digest('hex').slice(0, 40)}`;
    await secrets.set(storeName, 'sk-secret');
    await mkdir(join(dir, 'config', 'model-providers'), { recursive: true });
    await writeFile(
      join(dir, 'config', 'model-providers', 'anthropic.json'),
      JSON.stringify({ enabled: true, auth: { apiKey: { $secret: ref } } }),
    );

    // Reload so the store caches the hand-written section, then delete it.
    const reopened = await createConfigStore({ env, secrets });
    await reopened.load();
    expect(secrets.list().length).toBe(1);
    await reopened.deleteModelProvider('anthropic');
    expect(secrets.list().length).toBe(0);
    expect(reopened.modelProviders()).toEqual([]);
  });
});

describe('create* seeds + registers per-name sections', () => {
  it('seeds a schema-defaulted shell and returns the file path', async () => {
    const { store } = await openStore();

    const providerPath = await store.createModelProvider('anthropic');
    const pluginPath = await store.createPlugin('github');
    const toolPath = await store.createTool('bash');
    const mcpPath = await store.createMcpServer('filesystem');

    expect(providerPath).toBe(join(dir, 'config', 'model-providers', 'anthropic.json'));
    expect(pluginPath).toBe(join(dir, 'config', 'plugins', 'github.json'));
    expect(toolPath).toBe(join(dir, 'config', 'tools', 'bash.json'));
    expect(mcpPath).toBe(join(dir, 'config', 'mcp-servers', 'filesystem.json'));

    // Each seeded file is the base template, valid and immediately readable.
    expect(JSON.parse(await readFile(providerPath, 'utf8'))).toEqual({
      enabled: true,
      auth: {},
      defaultHeaders: {},
      models: [],
    });
    expect(store.tool('bash')?.enabled).toBe(true);
    expect(store.mcpServer('filesystem')?.enabled).toBe(true);
  });

  it('is idempotent: a second create leaves the file untouched and returns its path', async () => {
    const { store } = await openStore();
    const path = await store.createPlugin('github');

    // A hand edit after creation must survive a second create* call.
    await writeFile(path, JSON.stringify({ enabled: false, settings: { repo: 'a/b' } }));
    const again = await store.createPlugin('github');
    expect(again).toBe(path);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ enabled: false });
  });

  it('lists sections by name after creating them', async () => {
    const { store } = await openStore();
    await store.createModelProvider('anthropic');
    await store.createModelProvider('openai');
    await store.createPlugin('github');
    await store.createTool('bash');
    await store.createMcpServer('filesystem');
    expect(store.modelProviders().toSorted()).toEqual(['anthropic', 'openai']);
    expect(store.plugins()).toEqual(['github']);
    expect(store.tools()).toEqual(['bash']);
    expect(store.mcpServers()).toEqual(['filesystem']);
  });

  it('deletes tool and mcp-server sections', async () => {
    const { store } = await openStore();
    await store.createTool('bash');
    await store.createMcpServer('filesystem');
    expect(await store.deleteTool('bash')).toBe(true);
    expect(await store.deleteMcpServer('filesystem')).toBe(true);
    expect(await store.deleteTool('bash')).toBe(false);
    expect(store.tools()).toEqual([]);
    expect(store.mcpServers()).toEqual([]);
  });
});

describe('atomic + safe writes', () => {
  it('writes config files with owner-only permissions', async () => {
    const { store } = await openStore();
    await store.createModelProvider('anthropic');
    const stats = await stat(join(dir, 'config', 'model-providers', 'anthropic.json'));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('rejects an invalid section name before any disk access', async () => {
    const { store } = await openStore();
    await expect(store.createModelProvider('../evil')).rejects.toThrow(
      /Invalid config section name/u,
    );
  });
});

describe('registered schemas', () => {
  it('seeds a registered model-provider schema, applying its defaults', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const store = await createConfigStore({ env, secrets });
    const noneAuth = z.object({ kind: z.literal('none') });
    const authUnion = z.discriminatedUnion('kind', [noneAuth]).default({ kind: 'none' });
    store.registerModelProvider(
      'anthropic',
      z.looseObject({
        enabled: z.boolean().default(true),
        auth: authUnion,
        defaultHeaders: z.record(z.string(), z.string()).default({}),
        model: z.string().default('claude-opus-4-8'),
      }),
    );
    await store.init();
    await store.load();
    await store.createModelProvider('anthropic');
    expect((store.modelProvider('anthropic') as unknown as { model: string }).model).toBe(
      'claude-opus-4-8',
    );
  });
});
