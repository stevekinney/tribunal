import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/usage-cost-api.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
