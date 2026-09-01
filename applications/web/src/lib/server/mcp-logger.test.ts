import { describe, expect, it } from 'vitest';
import type { DestinationStream } from 'pino';
import { createMcpLogger } from './mcp-logger';

class MemoryDestination implements DestinationStream {
  output = '';

  write(message: string): void {
    this.output += message;
  }
}

const sensitiveKeys = [
  'authorization',
  'cookie',
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
] as const;

describe('createMcpLogger', () => {
  it.each([0, 1, 2])('redacts every sensitive key at nesting depth %i', (depth) => {
    const destination = new MemoryDestination();
    const logger = createMcpLogger({ destination });
    const canaries = Object.fromEntries(sensitiveKeys.map((key) => [key, `canary-${key}-secret`]));
    const payload =
      depth === 0
        ? canaries
        : depth === 1
          ? { child: canaries }
          : { child: { grandchild: canaries } };

    logger.info(payload, 'redaction canary');

    for (const value of Object.values(canaries)) expect(destination.output).not.toContain(value);
  });

  it.each([
    'Bearer free-text-secret',
    ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJjYW5hcnkifQ', 'signature'].join('.'),
    'postgres://canary:password@database.example/tribunal',
    'rediss://canary:password@redis.example/0',
  ])('scrubs credential-shaped value %s regardless of key', (credential) => {
    const destination = new MemoryDestination();
    const logger = createMcpLogger({ destination });

    logger.info({ diagnostic: `failure: ${credential}` }, 'credential canary');

    expect(destination.output).not.toContain(credential);
  });

  it('preserves request identifiers used for safe correlation', () => {
    const destination = new MemoryDestination();
    const logger = createMcpLogger({ destination });
    logger.info({ event: 'mcp_request', outcome: 'success', requestId: 'req-visible' });
    expect(destination.output).toContain('req-visible');
  });
});
