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
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/workflows/bootstrap.ts',
        // Test fixtures/fakes for review-workflow.test.ts and
        // review-workflow-default-model.test.ts, split out to keep both test
        // files under the max-lines lint budget. Not application code — same
        // reason `*.test.ts` files themselves are excluded above.
        'src/workflows/review-workflow-test-support.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
