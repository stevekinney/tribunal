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
      // Only the lib/** helpers are covered by this gate. The top-level
      // scripts/*.ts files (e.g. deploy.ts, doctor.ts, check-migration-consistency.ts)
      // are operational CLI tooling that shells out to Fly, GitHub, and Neon
      // against live infrastructure; they are not exercisable under a unit-test
      // gate the way lib/** logic is. This mirrors the documented
      // `src/test/**` exclusion in packages/database/vitest.configuration.ts,
      // which excludes that package's equivalent live-infrastructure tooling
      // for the same reason. Coverage for these top-level CLIs (~2,900 lines)
      // is tracked as a follow-up in stevekinney/tribunal#179 rather than
      // silently included in or excluded from this gate's scope.
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
