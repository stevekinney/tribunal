import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Match packages/test/src/vitest-timeout-policy.ts values
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        inline: ['prose-writer'],
      },
    },
    // Whole-package gate. The narrower test:coverage:review-engine script
    // overrides include/exclude/thresholds via CLI flags and is unaffected.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      // Barrel and type-only files match the database package's convention:
      // they are currently covered transitively, but excluding them keeps the
      // gate from failing spuriously if a test stops importing a barrel.
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/**/types.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
