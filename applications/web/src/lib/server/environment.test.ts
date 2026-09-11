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

  it('rejects sslmode=require and sslmode=verify-ca in production for a non-Neon host', () => {
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.com/tribunal?sslmode=require',
      }),
    ).toThrow(/verify-full/);
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.com/tribunal?sslmode=verify-ca',
      }),
    ).toThrow(/verify-full/);
  });

  it('accepts sslmode=verify-full in production for a non-Neon host', () => {
    // Positive control for the two rejections above: proves they reject on
    // sslmode, not merely on hostname.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.com/tribunal?sslmode=verify-full',
      }),
    ).not.toThrow();
  });

  it('exempts a Neon host in production even without sslmode=verify-full (outage regression)', () => {
    // TRI-124: production crash-looped for ~4 hours on 2026-09-09/10 because
    // this check rejected a production DATABASE_URL for lacking
    // sslmode=verify-full even though the host routes to Neon's neon-http
    // driver over HTTPS, where sslmode is inert. This is the exact case that
    // caused the outage: a Neon host, in production, without verify-full.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.neon.tech/tribunal?sslmode=require',
      }),
    ).not.toThrow();
    // No sslmode parameter at all.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.neon.tech/tribunal',
      }),
    ).not.toThrow();
    // .neon.build is also exempt, per the same shouldUseNeonHttp predicate.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgresql://user:pass@db.example.neon.build/tribunal?sslmode=require',
      }),
    ).not.toThrow();
  });

  it('does not require verify-full outside production', () => {
    expect(() => parseWebEnvironment(DEV_ENV)).not.toThrow();
  });

  it('exempts a local database host in production (loopback, docker host, .internal)', () => {
    // The production image boots against a throwaway local database in container
    // smoke tests; verify-full there needs a CA the local database lacks, and
    // the connection never crosses an untrusted network.
    for (const host of ['localhost', '127.0.0.1', 'host.docker.internal', 'db.svc.internal']) {
      expect(() =>
        parseWebEnvironment({
          ...PROD_ENV,
          DATABASE_URL: `postgres://tribunal:tribunal@${host}:5433/tribunal`,
        }),
      ).not.toThrow();
    }
    // IPv6 loopback: URL.hostname keeps the brackets (`[::1]`), so the exemption
    // must recognize the bracketed form.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL: 'postgres://tribunal:tribunal@[::1]:5433/tribunal',
      }),
    ).not.toThrow();
  });

  it('rejects a DATABASE_URL that is not a parseable URL in production', () => {
    expect(() => parseWebEnvironment({ ...PROD_ENV, DATABASE_URL: 'not a url' })).toThrow();
  });

  it('rejects a duplicated sslmode where a later value weakens it, for a non-Neon host', () => {
    // URLSearchParams.get returns the first value, but the pg parser keeps the
    // last; a lax check would pass this while the driver connects with ssl:false.
    // Hosted on a non-Neon host: a Neon host is now exempt from this check
    // entirely, so this must still exercise the node-postgres enforcement path.
    expect(() =>
      parseWebEnvironment({
        ...PROD_ENV,
        DATABASE_URL:
          'postgresql://user:pass@db.example.com/tribunal?sslmode=verify-full&sslmode=disable',
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

  it('treats a blank optional URL as unset, so a copied .env.example still boots', () => {
    // .env.example ships BASE_URL= (and blank Neon URLs); a copied template must
    // not fail init because '' is neither undefined nor a valid URL.
    expect(() =>
      parseWebEnvironment({ ...DEV_ENV, BASE_URL: '', NEON_AUTH_BASE_URL: '', MCP_BASE_URL: '' }),
    ).not.toThrow();
    expect(parseWebEnvironment({ ...DEV_ENV, BASE_URL: '' }).BASE_URL).toBeUndefined();
  });

  it('BASE_URL is an optional, known field (AC9)', () => {
    expect(webEnvironmentKeys).toContain('BASE_URL');
    expect(
      parseWebEnvironment({ ...DEV_ENV, BASE_URL: 'https://tribunal.example.com' }).BASE_URL,
    ).toBe('https://tribunal.example.com');
  });
});

describe('parseWebEnvironment — REDIS_URL blank normalization (TRI-49)', () => {
  it('is a known, optional field', () => {
    expect(webEnvironmentKeys).toContain('REDIS_URL');
    expect(webRequiredEnvironmentKeys).not.toContain('REDIS_URL');
  });

  it('normalizes a blank REDIS_URL to undefined so the no-Redis fallback runs', () => {
    // REDIS_URL= in a dotenv file disables Redis; it must not fail .url() at boot.
    expect(() => parseWebEnvironment({ ...DEV_ENV, REDIS_URL: '' })).not.toThrow();
    expect(parseWebEnvironment({ ...DEV_ENV, REDIS_URL: '' }).REDIS_URL).toBeUndefined();
  });

  it('accepts a valid REDIS_URL and still rejects a non-empty invalid one', () => {
    expect(parseWebEnvironment({ ...DEV_ENV, REDIS_URL: 'redis://localhost:6379' }).REDIS_URL).toBe(
      'redis://localhost:6379',
    );
    expect(() => parseWebEnvironment({ ...DEV_ENV, REDIS_URL: 'not-a-url' })).toThrow();
  });
});
