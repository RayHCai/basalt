import { defineConfig, mergeConfig } from 'vitest/config';

import base from '../../vitest.config';

// Silence the scoped logger during tests (the loop builds one by default via
// @basalt/observability).
export default mergeConfig(
  base,
  defineConfig({ test: { name: 'agent', env: { BASALT_LOG_LEVEL: 'silent' } } }),
);
