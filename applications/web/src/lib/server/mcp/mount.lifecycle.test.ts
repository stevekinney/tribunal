import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSvelteKitMcpMount } from '@lostgradient/mcp/sveltekit';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';

/**
 * The mount enforces one live instance per process and permanent disposal.
 * Vitest's `isolate: true` gives this file its own module state, so it stands
 * up exactly one mount and drives it through its whole lifecycle in order:
 * serve, refuse a second construction, then dispose and prove use-after-dispose
 * fails. (AC1, AC3.)
 */

let fixture: McpMountFixture;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
});

afterAll(async () => {
  // The last test disposes the mount; only the database remains to close.
  await fixture.database.close();
});

const discoveryRequest = () =>
  new Request('http://localhost:5173/.well-known/oauth-authorization-server');

describe('MCP mount lifecycle', () => {
  it('serves OAuth discovery metadata through the mounted surface', async () => {
    const response = await fixture.handle(discoveryRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issuer: string };
    expect(body.issuer).toBe('http://localhost:5173');
  });

  it('refuses a second mount construction in the same process', async () => {
    // The library checks mount state before validating input, so a bare call
    // still throws the single-instance error rather than a validation error.
    await expect(createSvelteKitMcpMount({} as never)).rejects.toThrow('already been constructed');
  });

  it('rejects use after disposal', async () => {
    await fixture.mount.dispose();
    await expect(fixture.handle(discoveryRequest())).rejects.toThrow('disposed');
  });
});
