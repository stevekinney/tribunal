import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ env: { MCP_SERVER_NAME: '' } as Record<string, string> }));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mocks.env;
  },
}));

const webPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

describe('tribunalMcpServerName', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    mocks.env.MCP_SERVER_NAME = '';
  });

  it('reports the configured server name', async () => {
    expect.assertions(1);
    mocks.env.MCP_SERVER_NAME = 'tribunal-mcp-server';

    const { tribunalMcpServerName } = await import('./server-identity');

    expect(tribunalMcpServerName).toBe('tribunal-mcp-server');
  });

  it('trims a padded configured name', async () => {
    expect.assertions(1);
    mocks.env.MCP_SERVER_NAME = '  tribunal-mcp-server  ';

    const { tribunalMcpServerName } = await import('./server-identity');

    expect(tribunalMcpServerName).toBe('tribunal-mcp-server');
  });

  it.each([
    ['unset', undefined],
    ['blank', '   '],
  ])('falls back rather than throwing at import when the name is %s', async (_label, value) => {
    expect.assertions(1);
    if (value === undefined) {
      delete mocks.env.MCP_SERVER_NAME;
    } else {
      mocks.env.MCP_SERVER_NAME = value;
    }

    const { tribunalMcpServerName } = await import('./server-identity');

    expect(tribunalMcpServerName).toBe('tribunal');
  });
});

describe('tribunalMcpServerVersion', () => {
  it("matches the web application's own package version", async () => {
    expect.assertions(1);

    const { tribunalMcpServerVersion } = await import('./server-identity');

    expect(tribunalMcpServerVersion).toBe(webPackage.version);
  });
});
