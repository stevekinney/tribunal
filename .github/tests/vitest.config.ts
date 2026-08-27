import { defineConfig } from 'vitest/config';

// `.github/**` is inside no Turborepo workspace, so these tests run directly
// rather than through a package's own `test` script. The root `package.json`
// scripts (`test:workflow-authorization`, `test:workflow-prompt-injection`,
// `test:production-migration-gate`) invoke `vitest run --config
// .github/tests/vitest.config.ts <suite-name>` directly -- NOT `bun run
// vitest run ...` -- and CI runs them via `bun run test:<suite-name>`.
// Scoping `root` here keeps the include glob from also matching
// `**/*.test.ts` files that live inside actual workspace packages.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
