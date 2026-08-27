import { describe, expect, it } from 'vitest';
import { getEnvironment, parseMcpServerEnvironment } from './env.js';

describe('parseMcpServerEnvironment', () => {
  it('parses a valid environment record', () => {
    const environment = parseMcpServerEnvironment({
      NODE_ENV: 'test',
      MCP_SERVER_NAME: 'my-server',
      MCP_CONFORMANCE_MODE: 'true',
      LOG_LEVEL: 'debug',
    });
    expect(environment).toEqual({
      NODE_ENV: 'test',
      MCP_SERVER_NAME: 'my-server',
      MCP_CONFORMANCE_MODE: true,
      LOG_LEVEL: 'debug',
    });
  });

  it('applies every default when handed an empty record', () => {
    const environment = parseMcpServerEnvironment({});
    expect(environment).toEqual({
      NODE_ENV: 'development',
      MCP_SERVER_NAME: undefined,
      MCP_CONFORMANCE_MODE: false,
      LOG_LEVEL: 'info',
    });
  });

  it('treats an empty string the same as an unset value, not an invalid one', () => {
    const environment = parseMcpServerEnvironment({ MCP_SERVER_NAME: '', NODE_ENV: 'test' });
    expect(environment.MCP_SERVER_NAME).toBeUndefined();
  });

  it('throws on an invalid value rather than silently ignoring it', () => {
    expect(() => parseMcpServerEnvironment({ MCP_CONFORMANCE_MODE: 'yes' })).toThrow();
  });

  it('never throws for a completely empty process.env-shaped record (no required field)', () => {
    expect(() => parseMcpServerEnvironment({})).not.toThrow();
  });
});

describe('getEnvironment', () => {
  it('returns a validated environment without throwing, memoized across calls', () => {
    const first = getEnvironment();
    const second = getEnvironment();
    expect(first).toBe(second);
    expect(first.LOG_LEVEL).toBeDefined();
    expect(first.NODE_ENV).toBeDefined();
  });
});
