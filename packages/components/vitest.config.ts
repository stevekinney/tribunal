import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // Stub SvelteKit runtime modules for tests.
      // Individual tests override these with vi.mock() as needed.
      '$app/paths': resolve(__dirname, 'test/stubs/app-paths.ts'),
      '$app/environment': resolve(__dirname, 'test/stubs/app-environment.ts'),
      // Test utilities local to this package.
      $testing: resolve(__dirname, 'test'),
    },
  },
  test: {
    // Match packages/test/src/vitest-timeout-policy.ts values
    hookTimeout: 30_000,
    testTimeout: 15_000,
    teardownTimeout: 10_000,
    setupFiles: ['./test/vitest.setup.ts'],
    projects: [
      {
        extends: './vitest.config.ts',
        test: {
          name: 'client',
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium', headless: true }],
          },
          // Retry browser tests once in CI to absorb transient Chromium failures.
          // Only set retry in CI; omit in non-CI so worktree config retry is inherited.
          ...(process.env.CI && { retry: 1 }),
          include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
      {
        extends: './vitest.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
