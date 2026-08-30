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
      // for the same reason. These entrypoints are verified by their owning integration and operational
      // gates; the deterministic helpers they share remain covered under lib/**.
      include: ['lib/**/*.ts'],
      // `*.bun-fixture.ts` files are excluded for a different reason than the
      // tests are: they ARE executed, but by Bun in a subprocess, which this
      // in-process instrumentation cannot observe, so they read as 0%. Their
      // execution is asserted by the spawning test's exit-code check rather
      // than by coverage. They exist because `import.meta.dir` is Bun-only, so
      // the behaviour they cover is unreachable from Vitest by construction.
      exclude: ['lib/**/*.test.ts', 'lib/**/*.bun-fixture.ts'],
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
