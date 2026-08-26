import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Match packages/test/src/vitest-timeout-policy.ts values
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      // Barrel files carry no executable logic of their own beyond
      // re-exports and the (currently empty) production/conformance-only
      // registry arrays. `conformance-server.ts` is a standalone process
      // entry point exercised by `test:conformance` against a real
      // listening port, not by the unit suite.
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/conformance-server.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
