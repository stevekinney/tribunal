import { describe, expect, it } from 'vitest';
import { parseEngineEnvironment } from './environment';

const fullEnvironment = {
  WEFT_DATABASE_URL: 'https://example.neon.tech/weft',
  TENSORLAKE_API_KEY: 'tensorlake-key',
  TRIBUNAL_SANDBOX_IMAGE: 'tribunal-reviewer:2026-06-17',
  TRIBUNAL_DEFAULT_MODEL: 'claude-sonnet-4-6',
  MAX_CONCURRENT_AGENTS: '3',
  PER_AGENT_BUDGET_USD: '1.25',
  DEFAULT_DAILY_COST_CAP_USD: '25',
  IDLE_SUSPEND_SECONDS: '900',
  SANDBOX_REAP_INTERVAL: '300',
  ENABLE_PROMPT_CACHING_1H: 'true',
  ANTHROPIC_ADMIN_KEY: 'anthropic-admin-key',
  WEFT_INSPECTOR: '0',
};

describe('parseEngineEnvironment', () => {
  it('parses the full engine environment fixture', () => {
    expect(parseEngineEnvironment(fullEnvironment)).toMatchObject({
      WEFT_DATABASE_URL: 'https://example.neon.tech/weft',
      MAX_CONCURRENT_AGENTS: 3,
      PER_AGENT_BUDGET_USD: 1.25,
      DEFAULT_DAILY_COST_CAP_USD: 25,
      IDLE_SUSPEND_SECONDS: 900,
      SANDBOX_REAP_INTERVAL: 300,
      ENABLE_PROMPT_CACHING_1H: true,
      WEFT_INSPECTOR: false,
    });
  });

  it('throws when a required engine variable is missing', () => {
    const { WEFT_DATABASE_URL: _removed, ...missingDatabaseUrl } = fullEnvironment;

    expect(() => parseEngineEnvironment(missingDatabaseUrl)).toThrow();
  });
});
