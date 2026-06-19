import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/runner-proxy.integration.test.ts', '**/node_modules/**', '**/.git/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
