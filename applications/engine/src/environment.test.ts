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
  ENCRYPTION_KEY: 'a'.repeat(64),
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
    const requiredVariables = [
      'DATABASE_URL',
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'TENSORLAKE_API_KEY',
      'TRIBUNAL_SANDBOX_IMAGE',
      'TRIBUNAL_PROXY_URL',
      'TRIBUNAL_PROXY_CIDR',
      'PROXY_SIGNING_KEY',
      'ENCRYPTION_KEY',
      'TRIBUNAL_ENGINE_CONTROL_TOKEN',
      'TRIBUNAL_DEFAULT_MODEL',
      'DEFAULT_DAILY_COST_CAP_USD',
      'IDLE_SUSPEND_SECONDS',
      'SANDBOX_REAP_INTERVAL',
      'ANTHROPIC_ADMIN_KEY',
    ] as const;

    for (const variableName of requiredVariables) {
      const environment = { ...fullEnvironment };
      delete environment[variableName];

      expect(() => parseEngineEnvironment(environment), variableName).toThrow();
    }
  });

  it('throws clearly when the default daily cost cap is zero', () => {
    expect(() =>
      parseEngineEnvironment({ ...fullEnvironment, DEFAULT_DAILY_COST_CAP_USD: '0' }),
    ).toThrow('must be greater than zero');
    expect(() =>
      parseEngineEnvironment({ ...fullEnvironment, DEFAULT_DAILY_COST_CAP_USD: '0.00' }),
    ).toThrow('must be greater than zero');
  });

  it('defaults prompt caching to false when omitted', () => {
    const { ENABLE_PROMPT_CACHING_1H: _removed, ...environment } = fullEnvironment;

    expect(parseEngineEnvironment(environment).ENABLE_PROMPT_CACHING_1H).toBe(false);
  });

  it('allows missing Weft storage only when ephemeral storage is explicitly enabled', () => {
    const { WEFT_DATABASE_URL: _removed, ...ephemeralEnvironment } = fullEnvironment;

    const parsedEnvironment = parseEngineEnvironment({
      ...ephemeralEnvironment,
      TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE: '1',
    });

    expect(parsedEnvironment.TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE).toBe(true);
    expect(parsedEnvironment).not.toHaveProperty('WEFT_DATABASE_URL');
  });

  it('throws when Weft storage is missing without ephemeral storage', () => {
    const { WEFT_DATABASE_URL: _removed, ...environment } = fullEnvironment;

    expect(() => parseEngineEnvironment(environment)).toThrow(
      'WEFT_DATABASE_URL is required unless ephemeral storage is explicitly enabled',
    );
  });
});
