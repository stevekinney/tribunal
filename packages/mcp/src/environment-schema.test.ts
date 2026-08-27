import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mcpServerEnvironmentSchema } from './environment-schema.js';

/**
 * `z.coerce.boolean()` calls JavaScript's `Boolean(value)`, and every
 * non-empty string -- including the literal string `"false"` -- is
 * truthy. `MCP_CONFORMANCE_MODE` must not.
 */
describe('mcpServerEnvironmentSchema MCP_CONFORMANCE_MODE', () => {
  const schema = z.object({
    MCP_CONFORMANCE_MODE: mcpServerEnvironmentSchema.MCP_CONFORMANCE_MODE,
  });

  it('the string "false" parses to false, not true', () => {
    expect(schema.parse({ MCP_CONFORMANCE_MODE: 'false' }).MCP_CONFORMANCE_MODE).toBe(false);
  });

  it('the string "true" parses to true', () => {
    expect(schema.parse({ MCP_CONFORMANCE_MODE: 'true' }).MCP_CONFORMANCE_MODE).toBe(true);
  });

  it('an unset value defaults to false', () => {
    expect(schema.parse({}).MCP_CONFORMANCE_MODE).toBe(false);
  });

  it('an unrecognized string fails validation instead of silently coercing', () => {
    expect(() => schema.parse({ MCP_CONFORMANCE_MODE: 'yes' })).toThrow();
  });
});

describe('mcpServerEnvironmentSchema MCP_SERVER_NAME', () => {
  const schema = z.object({ MCP_SERVER_NAME: mcpServerEnvironmentSchema.MCP_SERVER_NAME });

  it('is undefined when unset, carrying no hardcoded default', () => {
    expect(schema.parse({}).MCP_SERVER_NAME).toBeUndefined();
  });

  it('accepts a non-empty string', () => {
    expect(schema.parse({ MCP_SERVER_NAME: 'my-mcp-server' }).MCP_SERVER_NAME).toBe(
      'my-mcp-server',
    );
  });

  it('rejects an empty string rather than silently defaulting', () => {
    expect(() => schema.parse({ MCP_SERVER_NAME: '' })).toThrow();
  });
});

describe('mcpServerEnvironmentSchema NODE_ENV', () => {
  const schema = z.object({ NODE_ENV: mcpServerEnvironmentSchema.NODE_ENV });

  it('defaults to development when unset', () => {
    expect(schema.parse({}).NODE_ENV).toBe('development');
  });

  it('accepts production and test', () => {
    expect(schema.parse({ NODE_ENV: 'production' }).NODE_ENV).toBe('production');
    expect(schema.parse({ NODE_ENV: 'test' }).NODE_ENV).toBe('test');
  });

  it('rejects an unrecognized value', () => {
    expect(() => schema.parse({ NODE_ENV: 'staging' })).toThrow();
  });
});

describe('mcpServerEnvironmentSchema LOG_LEVEL', () => {
  const schema = z.object({ LOG_LEVEL: mcpServerEnvironmentSchema.LOG_LEVEL });

  it('defaults to info when unset', () => {
    expect(schema.parse({}).LOG_LEVEL).toBe('info');
  });

  it('accepts every documented pino level', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace']) {
      expect(schema.parse({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
    }
  });

  it('rejects an unrecognized level', () => {
    expect(() => schema.parse({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});
