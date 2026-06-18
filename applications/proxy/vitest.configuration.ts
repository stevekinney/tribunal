import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
