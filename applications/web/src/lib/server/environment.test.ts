import { describe, expect, it } from 'vitest';
import { parseWebEnvironment, webRequiredEnvironmentKeys, webEnvironmentKeys } from './environment';

const DEV_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/tribunal',
} satisfies Record<string, string>;

const PROD_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.example.neon.tech/tribunal?sslmode=verify-full',
  NEON_AUTH_BASE_URL: 'https://auth.example.com',
} satisfies Record<string, string>;

describe('parseWebEnvironment — SKIP_ENV_VALIDATION ban (AC1)', () => {
  it('throws if SKIP_ENV_VALIDATION is set to anything, including empty string', () => {
    expect(() => parseWebEnvironment({ ...DEV_ENV, SKIP_ENV_VALIDATION: '1' })).toThrow(
      /SKIP_ENV_VALIDATION/,
    );
    expect(() => parseWebEnvironment({ ...DEV_ENV, SKIP_ENV_VALIDATION: '' })).toThrow(
      /SKIP_ENV_VALIDATION/,
    );
  });

  it('parses a valid environment when SKIP_ENV_VALIDATION is unset', () => {
    expect(parseWebEnvironment(DEV_ENV).NODE_ENV).toBe('development');
  });
});

describe('parseWebEnvironment — NODE_ENV has no default (AC2)', () => {
  it('throws when NODE_ENV is absent', () => {
    const { NODE_ENV: _omitted, ...withoutNodeEnv } = DEV_ENV;
    expect(() => parseWebEnvironment(withoutNodeEnv)).toThrow();
  });

  it('rejects an unknown NODE_ENV value', () => {
    expect(() => parseWebEnvironment({ ...DEV_ENV, NODE_ENV: 'staging' })).toThrow();
  });
});

describe('parseWebEnvironment — strict boolean flags (AC5)', () => {
  it('treats "false" as disabled, not enabled', () => {
    expect(parseWebEnvironment({ ...DEV_ENV, MCP_ENABLED: 'false' }).MCP_ENABLED).toBe(false);
  });

  it('treats "true" as enabled and defaults to false when unset', () => {
    expect(parseWebEnvironment({ ...DEV_ENV, MCP_ENABLED: 'true' }).MCP_ENABLED).toBe(true);
    expect(parseWebEnvironment(DEV_ENV).MCP_ENABLED).toBe(false);
  });

  it('rejects a non-boolean flag string rather than coercing it', () => {
    expect(() => parseWebEnvironment({ ...DEV_ENV, MCP_ENABLED: 'yes' })).toThrow();
  });
});

describe('parseWebEnvironment — production TLS refusal (AC6)', () => {
  it('refuses NODE_TLS_REJECT_UNAUTHORIZED=0 in production', () => {
    expect(() => parseWebEnvironment({ ...PROD_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow(
      /NODE_TLS_REJECT_UNAUTHORIZED/,
    );
  });

  it('permits NODE_TLS_REJECT_UNAUTHORIZED=0 outside production', () => {
    expect(() =>
      parseWebEnvironment({ ...DEV_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
    ).not.toThrow();
  });
});

describe('parseWebEnvironment — production requires sslmode=verify-full (AC7)', () => {
  it('accepts verify-full in production', () => {
    expect(parseWebEnvironment(PROD_ENV).NODE_ENV).toBe('production');
  });

  it('rejects sslmode=require and sslmode=verify-ca in production', () => {
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.neon.tech/tribunal?sslmode=require',
      }),
    ).toThrow(/verify-full/);
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.neon.tech/tribunal?sslmode=verify-ca',
      }),
    ).toThrow(/verify-full/);
  });

  it('does not require verify-full outside production', () => {
    expect(() => parseWebEnvironment(DEV_ENV)).not.toThrow();
  });

  it('rejects a duplicated sslmode where a later value weakens it', () => {
    // URLSearchParams.get returns the first value, but the pg parser keeps the
    // last; a lax check would pass this while the driver connects with ssl:false.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL:
          'postgresql://user:pass@db.example.neon.tech/tribunal?sslmode=verify-full&sslmode=disable',
      }),
    ).toThrow(/verify-full/);
  });
});

describe('web environment schema — derived required keys (AC10)', () => {
  it('marks genuinely required variables and excludes optional/defaulted ones', () => {
    expect(webRequiredEnvironmentKeys).toContain('NODE_ENV');
    expect(webRequiredEnvironmentKeys).toContain('DATABASE_URL');
    // Optional or defaulted fields are not required.
    for (const optional of ['NEON_AUTH_BASE_URL', 'MCP_ENABLED', 'MCP_BASE_URL', 'BASE_URL']) {
      expect(webRequiredEnvironmentKeys).not.toContain(optional);
    }
  });

  it('BASE_URL is an optional, known field (AC9)', () => {
    expect(webEnvironmentKeys).toContain('BASE_URL');
    expect(
      parseWebEnvironment({ ...DEV_ENV, BASE_URL: 'https://tribunal.example.com' }).BASE_URL,
    ).toBe('https://tribunal.example.com');
  });
});
