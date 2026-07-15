import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { BASE_PORTS, getPortWithEnvOverride } from './scripts/lib/ports';

// github-webhook-schemas v1.1.0 exports "./registry" without a "require"
// condition. Both Rollup's commonjs--resolver and Node's ESM resolver fail
// to resolve this subpath on Vercel. Bypass the exports map entirely by
// resolving the dist file path directly via node_modules traversal.
const __configDir = dirname(fileURLToPath(import.meta.url));
const webhookRegistryFile = 'node_modules/github-webhook-schemas/dist/registry.js';
const localPath = resolve(__configDir, webhookRegistryFile);
const rootPath = resolve(__configDir, '../..', webhookRegistryFile);
const webhookRegistryPath = existsSync(localPath) ? localPath : rootPath;
const repositoryRoot = resolve(__configDir, '../..');
const preferRootEnvironment =
  process.env.CI !== 'true' &&
  process.env.VERCEL !== '1' &&
  process.env.TRIBUNAL_PREFER_SHELL_ENV !== '1';

loadDotenv({ path: resolve(repositoryRoot, '.env'), override: preferRootEnvironment });

const enableCoverageSourcemaps = process.env.COVERAGE === '1' || process.env.COVERAGE === 'true';

// Port configuration: env var overrides, falling back to base ports.
const devPort = getPortWithEnvOverride('VITE_PORT', BASE_PORTS.viteDev);
const previewPort = getPortWithEnvOverride('VITE_PREVIEW_PORT', BASE_PORTS.vitePreview);
const vitestBrowserPort = getPortWithEnvOverride('VITEST_BROWSER_PORT', BASE_PORTS.vitestBrowser);

export default defineConfig({
  envDir: repositoryRoot,
  plugins: [sveltekit(), devtoolsJson()],
  server: {
    port: devPort,
  },
  preview: { port: previewPort },
  resolve: {
    alias: {
      // Bypass Rollup's commonjs--resolver for this subpath export (see comment above)
      'github-webhook-schemas/registry': webhookRegistryPath,
    },
  },
  ssr: {
    noExternal: [/^@tribunal\/.*/, 'github-webhook-schemas'],
  },
  optimizeDeps: {
    include: [
      '@lostgradient/cinder/meter',
      'lucide-svelte/icons/pencil',
      'lucide-svelte/icons/plus',
      'lucide-svelte/icons/trash-2',
    ],
  },
  build: {
    sourcemap: enableCoverageSourcemaps,
  },
  worker: {
    // SvelteKit's code-splitting build requires ES module workers; IIFE is not
    // supported when multiple entry points are generated.
    format: 'es',
  },
  test: {
    expect: { requireAssertions: true },
    // PGlite WASM cold-start on CI runners exceeds the 10s default
    hookTimeout: 30_000,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage/vitest',
    },
    setupFiles: ['./test/vitest.setup.ts'],
    exclude: ['**/node_modules/**'],
    deps: {
      moduleDirectories: ['node_modules'],
    },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'client',
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium', headless: true }],
            api: { port: vitestBrowserPort },
            // Run browser tests sequentially to reduce action timeouts under load.
            fileParallelism: false,
          },
          // Retry browser tests once in CI to absorb transient Chromium failures.
          ...(process.env.CI && { retry: 1 }),
          include: [
            'src/**/*.svelte.{test,spec}.{js,ts}',
            'test/browser/**/*.svelte.{test,spec}.{js,ts}',
          ],
          exclude: ['src/lib/server/**'],
        },
      },
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          isolate: true, // Ensures module isolation between test files to prevent state pollution
          include: ['src/**/*.{test,spec}.{js,ts}', 'test/**/*.{test,spec}.{js,ts}'],
          exclude: [
            'src/**/*.svelte.{test,spec}.{js,ts}',
            // Performance tests run in isolation via test:perf to avoid timing interference
            '**/performance/**',
            '**/*.performance.test.{js,ts}',
            '**/performance.test.{js,ts}',
            // Browser tests run in the client project with vitest-browser-svelte
            'test/browser/**',
            // Playwright owns the end-to-end suite.
            'test/end-to-end/**',
          ],
        },
      },
    ],
  },
});
