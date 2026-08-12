import { isAbsolute, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
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
  STATE_DIR_ENV_VAR,
  STATE_DIR_NAME,
  stateDir,
  STORAGE_DIR_NAME,
  storageDir,
  TOOLS_DIR_NAME,
  toolFile,
  toolsDir,
} from './paths.js';

describe('stateDir', () => {
  it('defaults to <cwd>/.basalt', () => {
    expect(stateDir({})).toBe(join(process.cwd(), STATE_DIR_NAME));
    expect(STATE_DIR_NAME).toBe('.basalt');
  });

  it('honors an absolute BASALT_STATE_DIR override verbatim', () => {
    expect(stateDir({ [STATE_DIR_ENV_VAR]: '/var/lib/basalt' })).toBe('/var/lib/basalt');
  });

  it('resolves a relative BASALT_STATE_DIR against cwd', () => {
    const result = stateDir({ [STATE_DIR_ENV_VAR]: 'sub/dir' });
    expect(isAbsolute(result)).toBe(true);
    expect(result).toBe(join(process.cwd(), 'sub/dir'));
  });

  it('ignores an empty override', () => {
    expect(stateDir({ [STATE_DIR_ENV_VAR]: '' })).toBe(join(process.cwd(), STATE_DIR_NAME));
  });

  it('uses the same env var name @basalt/observability and @basalt/secrets read', () => {
    expect(STATE_DIR_ENV_VAR).toBe('BASALT_STATE_DIR');
  });
});

describe('config paths', () => {
  const env = { [STATE_DIR_ENV_VAR]: '/state' };

  it('places the config dir under the state dir', () => {
    expect(configDir(env)).toBe(join('/state', CONFIG_DIR_NAME));
    expect(CONFIG_DIR_NAME).toBe('config');
  });

  it('locates the main config file directly under the config dir', () => {
    expect(mainConfigFile(env)).toBe(join('/state', 'config', MAIN_CONFIG_FILE));
    expect(MAIN_CONFIG_FILE).toBe('main.json');
  });

  it('places the agent dir and its subdirs under the state dir', () => {
    expect(agentDir(env)).toBe(join('/state', AGENT_DIR_NAME));
    expect(agentToolsDir(env)).toBe(join('/state', 'agent', AGENT_TOOLS_DIR_NAME));
    expect(agentMcpsDir(env)).toBe(join('/state', 'agent', AGENT_MCPS_DIR_NAME));
    expect(agentModelProvidersDir(env)).toBe(
      join('/state', 'agent', AGENT_MODEL_PROVIDERS_DIR_NAME),
    );
    expect(AGENT_DIR_NAME).toBe('agent');
    expect(AGENT_TOOLS_DIR_NAME).toBe('tools');
    expect(AGENT_MCPS_DIR_NAME).toBe('mcps');
    expect(AGENT_MODEL_PROVIDERS_DIR_NAME).toBe('model-providers');
  });

  it('locates the per-kind section directories', () => {
    expect(modelProvidersDir(env)).toBe(join('/state', 'config', MODEL_PROVIDERS_DIR_NAME));
    expect(pluginsDir(env)).toBe(join('/state', 'config', PLUGINS_DIR_NAME));
    expect(toolsDir(env)).toBe(join('/state', 'config', TOOLS_DIR_NAME));
    expect(mcpServersDir(env)).toBe(join('/state', 'config', MCP_SERVERS_DIR_NAME));
    expect(MODEL_PROVIDERS_DIR_NAME).toBe('model-providers');
    expect(PLUGINS_DIR_NAME).toBe('plugins');
    expect(TOOLS_DIR_NAME).toBe('tools');
    expect(MCP_SERVERS_DIR_NAME).toBe('mcp-servers');
  });

  it('locates a named section file as <dir>/<name>.json', () => {
    expect(modelProviderFile('anthropic', env)).toBe(
      join('/state', 'config', 'model-providers', 'anthropic.json'),
    );
    expect(pluginFile('github', env)).toBe(join('/state', 'config', 'plugins', 'github.json'));
    expect(toolFile('bash', env)).toBe(join('/state', 'config', 'tools', 'bash.json'));
    expect(mcpServerFile('filesystem', env)).toBe(
      join('/state', 'config', 'mcp-servers', 'filesystem.json'),
    );
  });

  it('builds section file paths purely from the validated name (no traversal input reaches disk)', () => {
    // The name is validated by names.ts before this is ever called; here we only
    // assert the join shape so a caller cannot accidentally get a bare directory.
    expect(modelProviderFile('a', env).endsWith(join('model-providers', 'a.json'))).toBe(true);
  });
});

describe('storageDir', () => {
  const env = { [STATE_DIR_ENV_VAR]: '/state' };

  it('places the storage dir under the state dir', () => {
    expect(storageDir(env)).toBe(join('/state', STORAGE_DIR_NAME));
    expect(STORAGE_DIR_NAME).toBe('storage');
  });
});

describe('agent workspace paths', () => {
  const env = { [STATE_DIR_ENV_VAR]: '/state' };

  it('defaults the workspace base to the state dir when BASALT_AGENT_WORKSPACE_DIR is unset', () => {
    expect(agentWorkspaceBaseDir(env)).toBe('/state');
    expect(AGENT_WORKSPACE_DIR_ENV_VAR).toBe('BASALT_AGENT_WORKSPACE_DIR');
  });

  it('honors an absolute BASALT_AGENT_WORKSPACE_DIR override verbatim', () => {
    expect(agentWorkspaceBaseDir({ [AGENT_WORKSPACE_DIR_ENV_VAR]: '/work' })).toBe('/work');
  });

  it('resolves a relative BASALT_AGENT_WORKSPACE_DIR against cwd', () => {
    const result = agentWorkspaceBaseDir({ [AGENT_WORKSPACE_DIR_ENV_VAR]: 'sub/work' });
    expect(isAbsolute(result)).toBe(true);
    expect(result).toBe(join(process.cwd(), 'sub/work'));
  });

  it('ignores an empty override and falls back to the state dir', () => {
    expect(agentWorkspaceBaseDir({ ...env, [AGENT_WORKSPACE_DIR_ENV_VAR]: '' })).toBe('/state');
  });

  it('places the workspace root, shared, and sessions dirs under the base', () => {
    expect(agentWorkspaceDir(env)).toBe(join('/state', AGENT_WORKSPACE_DIR_NAME));
    expect(agentWorkspaceSharedDir(env)).toBe(
      join('/state', '.agent-workspace', AGENT_WORKSPACE_SHARED_DIR_NAME),
    );
    expect(agentWorkspaceSessionsDir(env)).toBe(
      join('/state', '.agent-workspace', AGENT_WORKSPACE_SESSIONS_DIR_NAME),
    );
    expect(AGENT_WORKSPACE_DIR_NAME).toBe('.agent-workspace');
    expect(AGENT_WORKSPACE_SHARED_DIR_NAME).toBe('shared');
    expect(AGENT_WORKSPACE_SESSIONS_DIR_NAME).toBe('sessions');
  });

  it('roots the workspace at BASALT_AGENT_WORKSPACE_DIR when set, decoupled from the state dir', () => {
    const relocated = { [STATE_DIR_ENV_VAR]: '/state', [AGENT_WORKSPACE_DIR_ENV_VAR]: '/work' };
    expect(agentWorkspaceDir(relocated)).toBe(join('/work', '.agent-workspace'));
    // The platform tree (state) is now a sibling, not an ancestor, of the workspace.
    expect(agentWorkspaceDir(relocated).startsWith('/state')).toBe(false);
  });

  it('locates a session cwd as <workspace>/sessions/<id>', () => {
    expect(agentWorkspaceSessionDir('session-123', env)).toBe(
      join('/state', '.agent-workspace', 'sessions', 'session-123'),
    );
  });

  it('locates a shared entry as <workspace>/shared/<name>', () => {
    expect(agentWorkspaceSharedEntryDir('cache', env)).toBe(
      join('/state', '.agent-workspace', 'shared', 'cache'),
    );
  });

  it('builds session/shared paths purely from the validated name (no traversal reaches disk)', () => {
    // Names are validated by names.ts before these are called; here we only assert
    // the join shape so a caller cannot accidentally escape the workspace subtree.
    expect(agentWorkspaceSessionDir('a', env).endsWith(join('sessions', 'a'))).toBe(true);
    expect(agentWorkspaceSharedEntryDir('a', env).endsWith(join('shared', 'a'))).toBe(true);
  });
});
