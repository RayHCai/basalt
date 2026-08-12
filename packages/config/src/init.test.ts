import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretStore } from '@basalt/secrets';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initConfig } from './init.js';

// oxlint-disable-next-line init-declarations
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basalt-config-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('initConfig', () => {
  it('seeds main config and reports the created paths on a fresh state dir', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const result = await initConfig({ env, secrets });

    expect(result.seeded).toBe(true);
    expect(result.stateDir).toBe(dir);
    expect(result.configDir).toBe(join(dir, 'config'));
    expect(result.secretsDir).toBe(join(dir, 'secrets'));
    expect(result.mainConfigPath).toBe(join(dir, 'config', 'main.json'));
    expect(result.agentDir).toBe(join(dir, 'agent'));
    expect(result.agentToolsDir).toBe(join(dir, 'agent', 'tools'));
    expect(result.agentMcpsDir).toBe(join(dir, 'agent', 'mcps'));
    expect(result.agentModelProvidersDir).toBe(join(dir, 'agent', 'model-providers'));
    expect(result.agentWorkspaceDir).toBe(join(dir, '.agent-workspace'));
    expect(result.agentWorkspaceSharedDir).toBe(join(dir, '.agent-workspace', 'shared'));
    expect(result.modelProviders).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.mcpServers).toEqual([]);

    // The file really exists and is valid.
    const parsed = JSON.parse(await readFile(result.mainConfigPath, 'utf8')) as {
      telemetry: boolean;
    };
    expect(parsed.telemetry).toBe(false);
  });

  it('creates STATE_DIR with its config/ and secrets/ children side by side', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const result = await initConfig({ env });

    // The root and both children exist as directories under one STATE_DIR.
    const [root, config, secrets] = await Promise.all([
      stat(result.stateDir),
      stat(result.configDir),
      stat(result.secretsDir),
    ]);
    expect(root.isDirectory()).toBe(true);
    expect(config.isDirectory()).toBe(true);
    expect(secrets.isDirectory()).toBe(true);
    expect(result.configDir).toBe(join(result.stateDir, 'config'));
    expect(result.secretsDir).toBe(join(result.stateDir, 'secrets'));
  });

  it('creates the agent/ tree with tools/, mcps/, and model-providers/ children', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const result = await initConfig({ env });

    const [agent, tools, mcps, providers] = await Promise.all([
      stat(result.agentDir),
      stat(result.agentToolsDir),
      stat(result.agentMcpsDir),
      stat(result.agentModelProvidersDir),
    ]);
    expect(agent.isDirectory()).toBe(true);
    expect(tools.isDirectory()).toBe(true);
    expect(mcps.isDirectory()).toBe(true);
    expect(providers.isDirectory()).toBe(true);
    expect(result.agentDir).toBe(join(result.stateDir, 'agent'));
  });

  it('creates the .agent-workspace/ tree with its shared/ child', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const result = await initConfig({ env });

    const [workspace, shared] = await Promise.all([
      stat(result.agentWorkspaceDir),
      stat(result.agentWorkspaceSharedDir),
    ]);
    expect(workspace.isDirectory()).toBe(true);
    expect(shared.isDirectory()).toBe(true);
    expect(result.agentWorkspaceDir).toBe(join(dir, '.agent-workspace'));
    expect(result.agentWorkspaceSharedDir).toBe(join(result.agentWorkspaceDir, 'shared'));
  });

  it('does not pre-create a sessions/ dir — session cwds are made per-run', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const result = await initConfig({ env });
    await expect(stat(join(result.agentWorkspaceDir, 'sessions'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('roots .agent-workspace under BASALT_AGENT_WORKSPACE_DIR when set, outside the state dir', async () => {
    const workspaceBase = await mkdtemp(join(tmpdir(), 'basalt-agent-workspace-'));
    try {
      const env = { BASALT_STATE_DIR: dir, BASALT_AGENT_WORKSPACE_DIR: workspaceBase };
      const result = await initConfig({ env });

      expect(result.agentWorkspaceDir).toBe(join(workspaceBase, '.agent-workspace'));
      const shared = await stat(result.agentWorkspaceSharedDir);
      expect(shared.isDirectory()).toBe(true);
      // The platform tree (state dir) has no workspace under it when relocated.
      await expect(stat(join(dir, '.agent-workspace'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(workspaceBase, { recursive: true, force: true });
    }
  });

  it('is idempotent — a second run leaves an existing agent/ tree intact', async () => {
    const env = { BASALT_STATE_DIR: dir };
    await initConfig({ env });
    // A second run must not throw on already-present directories.
    const second = await initConfig({ env });
    const tools = await stat(second.agentToolsDir);
    expect(tools.isDirectory()).toBe(true);
  });

  it('reports seeded=false when main config already exists, and lists sections', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });

    // First run seeds; second run should see it already present.
    await initConfig({ env, secrets });
    const second = await initConfig({ env, secrets });
    expect(second.seeded).toBe(false);
  });

  it('returns a ready-to-use store so callers can immediately read config', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const secrets = await createSecretStore({ dir: join(dir, 'secrets'), env });
    const result = await initConfig({ env, secrets });
    // The returned store is already loaded.
    expect(result.store.main().telemetry).toBe(false);
  });

  it('opens its own secret store when none is injected', async () => {
    const env = { BASALT_STATE_DIR: dir };
    const result = await initConfig({ env });
    expect(result.seeded).toBe(true);
    expect(result.store.main().telemetry).toBe(false);
  });
});
