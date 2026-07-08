import { defineConfig } from 'vitest/config';

// Shared Vitest base config. Tests live NEXT TO their source (README), so the
// include globs match `*.test.ts` / `*.spec.ts` anywhere under a package's src.
//
// Per-package pattern (create inside each real package as it lands):
//   import { defineConfig, mergeConfig } from 'vitest/config';
//   import base from '../../vitest.config';
//   export default mergeConfig(base, defineConfig({ test: { name: 'config' } }));
//
// Wiring: each package adds a `"test": "vitest run"` script; `turbo run test`
// then fans out across packages (same per-package model as build/typecheck).
// Until packages land this config only serves `pnpm test:watch` at the root.
export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.?(c|m)ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    // No global setup: keep each package hermetic.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/dist/**', '**/*.config.*', '**/*.d.ts'],
    },
  },
});
