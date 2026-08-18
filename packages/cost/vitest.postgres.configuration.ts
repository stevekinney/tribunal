import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@tribunal/review-core/review-cost-limits': fileURLToPath(
        new URL('../review-core/src/review-cost-limits.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.postgres-spec.ts'],
  },
});
