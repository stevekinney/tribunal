import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@tribunal/agents',
        replacement: resolve(import.meta.dirname, '../packages/agents/src/index.ts'),
      },
      {
        find: /^@tribunal\/review-core\/(.+)$/,
        replacement: resolve(import.meta.dirname, '../packages/review-core/src/$1.ts'),
      },
      {
        find: '@tribunal/review-core',
        replacement: resolve(import.meta.dirname, '../packages/review-core/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['*.test.mjs'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['run-agent.mjs', 'verify-image-checks.mjs'],
      exclude: ['*.test.mjs', 'verify-image.mjs'],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
});
