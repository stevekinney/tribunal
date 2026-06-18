import { describe, expect, it } from 'vitest';
import { parseEngineEnvironment } from './environment';

const fullEnvironment = {
  DATABASE_URL: 'https://example.neon.tech/app',
  REDIS_URL: 'redis://localhost:6379',
  WEFT_DATABASE_URL: 'https://example.neon.tech/weft',
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: 'github-private-key',
  TENSORLAKE_API_KEY: 'tensorlake-key',
  TRIBUNAL_SANDBOX_IMAGE: 'tribunal-reviewer:2026-06-17',
  TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.test',
  TRIBUNAL_PROXY_CIDR: '10.0.0.8/32',
  PROXY_SIGNING_KEY: 'proxy-signing-key',
  TRIBUNAL_ENGINE_CONTROL_TOKEN: 'engine-control-token',
  TRIBUNAL_DEFAULT_MODEL: 'claude-sonnet-4-6',
  DEFAULT_DAILY_COST_CAP_USD: '25',
  IDLE_SUSPEND_SECONDS: '900',
  SANDBOX_REAP_INTERVAL: '300',
  ENABLE_PROMPT_CACHING_1H: 'true',
  ANTHROPIC_ADMIN_KEY: 'anthropic-admin-key',
  REVIEWS_ENABLED: 'false',
  WEFT_INSPECTOR: '0',
};

describe('parseEngineEnvironment', () => {
  it('parses the full engine environment fixture', () => {
    expect(parseEngineEnvironment(fullEnvironment)).toMatchObject({
      WEFT_DATABASE_URL: 'https://example.neon.tech/weft',
      DEFAULT_DAILY_COST_CAP_USD: 25,
      IDLE_SUSPEND_SECONDS: 900,
      SANDBOX_REAP_INTERVAL: 300,
      ENABLE_PROMPT_CACHING_1H: true,
      REVIEWS_ENABLED: false,
      WEFT_INSPECTOR: false,
    });
  });

  it('throws when a required engine variable is missing', () => {
    const { WEFT_DATABASE_URL: _removed, ...missingDatabaseUrl } = fullEnvironment;

    expect(() => parseEngineEnvironment(missingDatabaseUrl)).toThrow();
  });
});
