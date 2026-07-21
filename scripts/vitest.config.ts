import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Match packages/test/src/vitest-timeout-policy.ts values
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    include: ['lib/**/*.test.ts'],
    root: import.meta.dirname,
    environment: 'node',
    server: {
      deps: {
        // prose-writer's dist/index.js uses extensionless ESM imports
        // (e.g., './prose-writer' instead of './prose-writer.js'), which
        // Node/Vite's resolver rejects. Inlining bundles it directly,
        // bypassing the broken resolution.
        inline: ['prose-writer'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
      },
    },
  },
  // Externalize database drivers that drizzle-kit dynamically imports
  // to prevent bundling errors during test runs
  ssr: {
    external: [
      'pg',
      'postgres',
      '@vercel/postgres',
      'mysql2',
      '@planetscale/database',
      '@libsql/client',
      'better-sqlite3',
    ],
  },
});
