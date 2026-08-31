import pino from 'pino';
import type { DestinationStream, LoggerOptions } from 'pino';

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

export const mcpRedactionPaths = sensitiveKeys.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

const credentialPatterns = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g,
  /(?:postgres(?:ql)?|rediss?):\/\/[^:@/\s"]+:[^@/\s"]+@[^\s"]+/gi,
] as const;

function scrubCredentialValues(serializedRecord: string): string {
  return credentialPatterns.reduce(
    (record, pattern) => record.replace(pattern, '[REDACTED]'),
    serializedRecord,
  );
}

/** Creates Tribunal's MCP logger, including key and credential-shape redaction. */
export function createMcpLogger(options?: { destination?: DestinationStream }): pino.Logger {
  const loggerOptions: LoggerOptions = {
    redact: { paths: mcpRedactionPaths, censor: '[REDACTED]' },
    hooks: { streamWrite: scrubCredentialValues },
  };
  return options?.destination ? pino(loggerOptions, options.destination) : pino(loggerOptions);
}

export const mcpLogger = createMcpLogger();
