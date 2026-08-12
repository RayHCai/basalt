import { defineConfig, mergeConfig } from 'vitest/config';

import base from '../../vitest.config';

// Silence the scoped logger during tests (createProviderContext builds one by
// default via @basalt/observability).
export default mergeConfig(
  base,
  defineConfig({ test: { name: 'model-provider', env: { BASALT_LOG_LEVEL: 'silent' } } }),
);
