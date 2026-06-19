import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_PORTS, getPortWithEnvOverride } from './scripts/lib/ports';

const port = getPortWithEnvOverride('PLAYWRIGHT_PORT', BASE_PORTS.playwright);
const e2eSecret = process.env.E2E_TEST_SECRET ?? `tribunal-e2e-${randomUUID()}`;
process.env.E2E_TEST_MODE = '1';
process.env.E2E_TEST_SECRET = e2eSecret;
process.env.VITE_PORT = String(port);

export default defineConfig({
  testDir: './test/end-to-end',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1',
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATABASE_URL: 'postgres://placeholder:placeholder@localhost:5432/placeholder',
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: 'placeholder',
      GITHUB_OAUTH_CLIENT_ID: 'placeholder',
      GITHUB_OAUTH_CLIENT_SECRET: 'placeholder',
      SESSION_SECRET: 'placeholder-secret-at-least-32-chars-long',
      E2E_TEST_MODE: '1',
      E2E_TEST_SECRET: e2eSecret,
      VITE_PORT: String(port),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
