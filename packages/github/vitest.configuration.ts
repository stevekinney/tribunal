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
  },
});
