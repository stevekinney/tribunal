import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Control the dev auth bypass flag per test. The fixture routes requests through
// the real createMcpHandle, which reads isDevAuthBypassEnabled() to
// decide whether to prime a locals-derived identity into the mount.
vi.mock('$lib/server/auth/dev-auth-bypass-flag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth/dev-auth-bypass-flag')>()),
  isDevAuthBypassEnabled: vi.fn(() => false),
}));

import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';
import { mcpBaseUrl, mcpResourceUrl } from '$lib/server/oauth/configuration';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * TRI-45 AC2: the development auth bypass must not produce an authenticated MCP
 * session on the mounted surface. The bypass populates `event.locals.user` with
 * a synthetic user for browsing the authenticated UI; if that identity were
 * primed into the mount, an externally reachable dev server (a tunnel) would let
 * any client complete `/oauth/authorize` as the synthetic user and mint a real
 * token. This drives the authorize GET through Tribunal's real mount with a user
 * on `locals` and proves that, with the bypass armed, the consent flow does not
 * proceed — the mount falls back to the cookie-based identity seam, which a
 * bypass session (no Neon Auth cookie) cannot satisfy.
 */

const BASE = mcpBaseUrl.origin;
const RESOURCE = mcpResourceUrl.href;
const CLIENT_ID = 'dev-auth-isolation-client';
const REDIRECT_URI = 'https://client.example/callback';
// A valid PKCE S256 challenge: 43 base64url characters.
const CODE_CHALLENGE = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'dev-auth-user', email: 'd@example.com', name: 'Dev Auth User' })
    .returning();
  applicationUser = {
    id: row!.id,
    username: row!.username,
    name: row!.name,
    avatarUrl: row!.avatarUrl,
    email: row!.email,
    isPlatformAdministrator: row!.isPlatformAdministrator,
  };
  await fixture.stores.clients.register({
    clientId: CLIENT_ID,
    clientSecretHash: null,
    clientName: 'Dev Auth Isolation Client',
    clientType: 'public',
    tokenEndpointAuthMethod: 'none',
    applicationType: 'native',
    redirectUris: [REDIRECT_URI],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    clientIdMetadataUrl: null,
    clientSecretExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  await fixture.dispose();
});

beforeEach(() => {
  vi.mocked(isDevAuthBypassEnabled).mockReturnValue(false);
});

function authorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    scope: 'repositories:read',
    state: 'xyz',
  });
  return `${BASE}/oauth/authorize?${params.toString()}`;
}

/** Authorize GET with the synthetic user on locals, app db routed to PGlite. */
function getAuthorize(): Promise<Response> {
  return runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(new Request(authorizeUrl()), { user: applicationUser }),
  );
}

describe('dev auth bypass isolation on the mounted surface (TRI-45 AC2)', () => {
  it('serves the consent prompt when the bypass is not armed (control)', async () => {
    const response = await getAuthorize();
    const html = await response.text();
    // The consent prompt carries a live transaction the user can approve/deny.
    expect(html).toContain('name="transaction_id"');
  });

  it('returns a terminal 403 instead of serving consent when the bypass is armed', async () => {
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(true);
    const response = await getAuthorize();
    // With the synthetic identity withheld from the mount, the request is
    // unauthenticated. The seam returns a terminal 403 (not a /login redirect,
    // which would loop because the bypass user is authenticated on /login) — so
    // no consent transaction is minted for the bypass user. Asserting the
    // concrete terminal response, not merely the absence of a consent field,
    // means an unrelated 404/500 cannot pass this test.
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.text()).resolves.toMatch(/cannot authorize/i);
  });
});
