import { defineConfig, mergeConfig } from 'vitest/config';

import base from '../../vitest.config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: 'runtime',
      // initConfig exercises @basalt/config, which logs via observability's
      // process-global root. Silence it for clean test output.
      env: { BASALT_LOG_LEVEL: 'silent' },
    },
  }),
);
