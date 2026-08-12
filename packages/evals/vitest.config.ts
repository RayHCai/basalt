import { defineConfig, mergeConfig } from 'vitest/config';

import base from '../../vitest.config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: 'evals',
      // The runner exercises @basalt/agent → @basalt/config, which log via
      // observability's process-global root. Silence it for clean test output.
      env: { BASALT_LOG_LEVEL: 'silent' },
    },
  }),
);
