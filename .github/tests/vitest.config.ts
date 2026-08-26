import { defineConfig } from 'vitest/config';

// `.github/**` is inside no Turborepo workspace, so these tests run directly
// with `bun run vitest run --config .github/tests/vitest.config.ts` from the
// repository root rather than through a package's own `test` script. Scoping
// `root` here keeps the include glob from also matching `**/*.test.ts` files
// that live inside actual workspace packages.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
