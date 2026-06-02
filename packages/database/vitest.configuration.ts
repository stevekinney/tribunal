import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // @tribunal/test depends on @tribunal/database, so declaring it as a
      // devDependency would create a cycle that Turborepo rejects. Use an
      // alias to resolve the import for tests without a package-level dependency.
      '@tribunal/test': new URL('../test/src', import.meta.url).pathname,
    },
  },
  test: {
    // Match packages/test/src/vitest-timeout-policy.ts values
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    name: 'database',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
