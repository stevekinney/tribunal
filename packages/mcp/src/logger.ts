import { createRequire } from 'node:module';
import pino from 'pino';
import type { DestinationStream, LoggerOptions } from 'pino';

import { getEnvironment } from './env.js';

/**
 * The redaction paths this server's request boundary is expected to carry
 * at some point -- OAuth authorization codes, PKCE verifiers, access and
 * refresh tokens, ID tokens, client secrets, session cookies, database and
 * Redis connection strings (which embed credentials in the URL itself),
 * and user email addresses.
 *
 * Pino's `redact.paths` (backed by `fast-redact`) matches by KEY, not by
 * value, and its wildcard (`*`) only spans a single object level -- there
 * is no recursive `**`. So paths are enumerated at the depths a call site
 * plausibly logs at: top-level (`{ token, ... }` directly), one level
 * nested (`{ headers: { authorization } }`, `{ client: { client_secret } }`),
 * and the specific two-level `headers.*` shape a request-logging call site
 * would use. A secret landing at some other, unanticipated depth is not
 * caught by key-path redaction -- that gap is exactly what
 * `redactSecretValues` below (wired through pino's `hooks.streamWrite`)
 * exists to catch by VALUE instead, and `redaction.test.ts` proves both
 * mechanisms against a real, unmocked logger rather than trusting this
 * list is complete.
 */
export const redactionPaths: readonly string[] = [
  // Top-level: a call site logs the sensitive field directly on the log object.
  'authorization',
  'cookie',
  '["set-cookie"]',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'code_verifier',
  'code_challenge',
  'client_secret',
  'password',
  'state',
  'email',
  'DATABASE_URL',
  'REDIS_URL',
  'databaseUrl',
  'redisUrl',
  'query',
  'body',
  'formData',
  'headers.authorization',
  'headers.cookie',
  // One level nested: the sensitive field lives on a child object
  // (`{ headers: {...} }`, `{ client: {...} }`, an `err` with extra
  // properties attached, etc.).
  '*.authorization',
  '*.cookie',
  '*["set-cookie"]',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.code',
  '*.code_verifier',
  '*.code_challenge',
  '*.client_secret',
  '*.password',
  '*.state',
  '*.email',
  '*.DATABASE_URL',
  '*.REDIS_URL',
  '*.databaseUrl',
  '*.redisUrl',
  '*.query',
  '*.body',
  '*.formData',
  // Two levels nested: the common `{ <anything>: { headers: { authorization } } }`
  // shape (e.g. a logged request/response object).
  '*.headers.authorization',
  '*.headers.cookie',
];

/**
 * Value-based redaction, applied to the fully serialized log line via
 * pino's `hooks.streamWrite` (the string is already valid JSON at that
 * point; each pattern is replaced in place, which keeps the JSON valid
 * since only a string VALUE's contents change, never structure or
 * quoting). Deliberately narrow -- it targets shapes that are
 * unambiguously secrets wherever they appear, not a general-purpose
 * scanner: pino owns key redaction; this only covers the value shapes key
 * redaction structurally cannot reach (an unanticipated nesting depth, a
 * secret interpolated into a free-text error message).
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // `Authorization: Bearer <token>` or a bare bearer token value.
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // JSON Web Tokens (ID tokens, and any access token issued as a JWT):
  // three base64url segments, the first always decoding to a JSON object
  // and therefore always starting with `eyJ`.
  /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g,
  // Postgres/Redis connection strings with inline credentials.
  /(?:postgres(?:ql)?|rediss?):\/\/[^:@/\s"]+:[^@/\s"]+@[^\s"]+/gi,
];

function redactSecretValues(serialized: string): string {
  let result = serialized;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function canResolvePrettyTransport(): boolean {
  try {
    // `createRequire` rather than a Bun-specific resolver: this package's
    // tsconfig does not pull in Bun's globals, and module resolution is
    // the one thing here with a portable answer.
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * A factory, not just a singleton export, so tests can build a real logger
 * -- the actual redaction config below, not a copy of it -- against an
 * in-memory destination instead of stdout. Passing `destination` also
 * forces plain JSON output (no `pino-pretty` transport): pino refuses to
 * combine `options.transport` with a destination stream argument, and
 * tests need to parse exactly what was written, not a human-formatted
 * approximation of it.
 */
export function createLogger(options?: { destination?: DestinationStream }): pino.Logger {
  const environment = getEnvironment();
  const isProduction = environment.NODE_ENV === 'production';

  const baseOptions: LoggerOptions = {
    level: environment.LOG_LEVEL,
    redact: { paths: [...redactionPaths], censor: '[REDACTED]' },
    hooks: { streamWrite: redactSecretValues },
  };

  if (options?.destination) {
    return pino(baseOptions, options.destination);
  }

  // `pino-pretty` is a devDependency, so it is absent from a production
  // install (`bun install --production`). Selecting the transport on
  // `NODE_ENV` alone would crash startup for any non-production run where
  // `pino-pretty` happens not to be resolvable. Resolve before requiring,
  // and fall back to plain JSON -- pretty output is a developer
  // convenience; refusing to start because a formatting dependency is
  // missing is never the right trade.
  const prettyTransportAvailable = !isProduction && canResolvePrettyTransport();

  return pino({
    ...baseOptions,
    ...(prettyTransportAvailable && { transport: { target: 'pino-pretty' } }),
  });
}

export const logger = createLogger();
