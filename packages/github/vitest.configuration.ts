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
      // Barrel files and genuinely type-only modules (verified to contain no
      // executable functions/consts). src/dashboard/types.ts and
      // src/webhooks/types.ts are NOT listed here: both export real runtime
      // helpers (isAttentionCiStatus, MAX_PAYLOAD_SIZE, etc.) and stay gated.
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/sync/types.ts',
        'src/pull-requests/action-items/types.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
