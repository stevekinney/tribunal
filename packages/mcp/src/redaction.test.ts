import { describe, it, expect } from 'vitest';
import type { DestinationStream } from 'pino';
import { createLogger } from './logger.js';

/**
 * OBS-001 / S-14: `logger.ts` previously declared no redaction paths at
 * all. This is the regression guard — a canary corpus of one representative
 * value per credential type this codebase's request boundary actually
 * handles (OAuth authorization codes, PKCE verifiers, access/refresh
 * tokens, ID tokens, client secrets, session cookies, database/Redis
 * connection strings, user email addresses), logged through the REAL
 * `createLogger` config (not a copy of the redaction paths) into an
 * in-memory destination, then asserted absent from the serialized output.
 * A new sensitive field added anywhere without a matching redaction path
 * fails this test the moment its canary value is added below and logged
 * under the same key shape a real call site would use.
 */

class MemoryDestination implements DestinationStream {
  lines: string[] = [];
  write(msg: string): void {
    this.lines.push(msg);
  }
  get output(): string {
    return this.lines.join('');
  }
}

function loggerWithCapture(): {
  logger: ReturnType<typeof createLogger>;
  destination: MemoryDestination;
} {
  const destination = new MemoryDestination();
  const logger = createLogger({ destination });
  return { logger, destination };
}

// One representative, unambiguous value per credential type this
// package's request boundary handles. Each is distinctive enough that an
// accidental substring match elsewhere in the log line would be
// implausible.
const canaries = {
  authorizationHeader: 'Bearer canary-bearer-token-9f3a1c2d4e5b6a7c8d9e0f1a2b3c4d5e',
  cookie: 'session=canary-cookie-value-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  accessToken: 'canary-access-token-7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a',
  refreshToken: 'canary-refresh-token-3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f',
  // Assembled at runtime rather than written as a literal. A committed
  // three-segment JWT — even an obviously synthetic one — matches gitleaks'
  // `jwt` rule and fails the full-history secret scan. The scan is right to
  // be blunt about that, so the fix is to stop committing the shape rather
  // than to widen `.gitleaks.toml`, which the security workflow explicitly
  // says must not absorb new findings.
  idToken: [
    btoa(JSON.stringify({ alg: 'RS256' })),
    btoa(JSON.stringify({ sub: 'canary-id-token-subject' })),
    'canary-id-token-signature-abc123',
  ].join('.'),
  authorizationCode: 'canary-authorization-code-4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
  pkceVerifier: 'canary-pkce-code-verifier-5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c',
  clientSecret: 'canary-client-secret-6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
  password: 'canary-password-7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e',
  databaseUrl: 'postgres://canary_user:canary_db_password@db.example.com:5432/canary_database',
  redisUrl: 'rediss://canary_user:canary_redis_password@redis.example.com:6379',
  email: 'canary-user@example.com',
} as const;

describe('logger redaction', () => {
  it('redacts every credential type when logged under its top-level key', () => {
    const { logger, destination } = loggerWithCapture();

    logger.info({
      authorization: `Bearer ${canaries.authorizationHeader}`,
      cookie: canaries.cookie,
      access_token: canaries.accessToken,
      refresh_token: canaries.refreshToken,
      id_token: canaries.idToken,
      code: canaries.authorizationCode,
      code_verifier: canaries.pkceVerifier,
      client_secret: canaries.clientSecret,
      password: canaries.password,
      DATABASE_URL: canaries.databaseUrl,
      REDIS_URL: canaries.redisUrl,
      email: canaries.email,
    });

    const output = destination.output;
    for (const value of Object.values(canaries)) {
      expect(output).not.toContain(value);
    }
  });

  it('redacts every credential type when nested one level deep', () => {
    const { logger, destination } = loggerWithCapture();

    logger.info({
      headers: {
        authorization: `Bearer ${canaries.authorizationHeader}`,
        cookie: canaries.cookie,
      },
      client: {
        client_secret: canaries.clientSecret,
      },
      token: {
        access_token: canaries.accessToken,
        refresh_token: canaries.refreshToken,
        id_token: canaries.idToken,
      },
      request: {
        code: canaries.authorizationCode,
        code_verifier: canaries.pkceVerifier,
      },
      config: {
        databaseUrl: canaries.databaseUrl,
        redisUrl: canaries.redisUrl,
      },
      user: {
        email: canaries.email,
      },
    });

    const output = destination.output;
    for (const value of Object.values(canaries)) {
      expect(output).not.toContain(value);
    }
  });

  it('redacts a raw bearer token value even at an unlisted key (value-based fallback)', () => {
    const { logger, destination } = loggerWithCapture();

    // Simulates a secret interpolated into free text (e.g. an error
    // message) rather than carried as a structured field — the shape
    // key-path redaction structurally cannot reach, and exactly what
    // `hooks.streamWrite`'s value-based scrub exists for.
    logger.info(`Rejected request with Authorization: Bearer ${canaries.authorizationHeader}`);

    expect(destination.output).not.toContain(canaries.authorizationHeader);
  });

  it('redacts a JWT-shaped value at an unlisted key (value-based fallback)', () => {
    const { logger, destination } = loggerWithCapture();

    logger.info({ someUnlistedField: canaries.idToken }, 'diagnostic message');

    expect(destination.output).not.toContain(canaries.idToken);
  });

  it('redacts a database connection string embedded in a nested error message', () => {
    const { logger, destination } = loggerWithCapture();

    const err = new Error(`connection failed: ${canaries.databaseUrl}`);
    logger.error({ err }, 'Database connection error');

    expect(destination.output).not.toContain(canaries.databaseUrl);
  });

  it('does not redact ordinary, non-sensitive structured fields', () => {
    const { logger, destination } = loggerWithCapture();

    logger.info(
      { requestId: 'req-canary-visible-1', method: 'POST', path: '/mcp', status: 200 },
      'Request handled',
    );

    const output = destination.output;
    expect(output).toContain('req-canary-visible-1');
    expect(output).toContain('/mcp');
  });
});
