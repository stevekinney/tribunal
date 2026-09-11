import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { mcpBaseUrl, mcpIssuer, mcpResourceUrl } from '$lib/server/oauth/configuration';
import { neonAuthTokenCookieName } from '$lib/server/auth/neon-session';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * TRI-122: the OAuth consent screen ships zero client JavaScript (TRI-40 AC4)
 * and is served by the mount seam outside SvelteKit's page pipeline, so the
 * short-lived Neon Auth JWT is never refreshed while the consent page sits open.
 * A JWT valid at `GET /oauth/authorize` render can lapse before the user clicks
 * Approve; the approve/deny POST then resolves no identity and the pending grant
 * is lost to a `/login` bounce.
 *
 * The fix accepts a JWT expired by up to the 10-minute authorization-transaction
 * TTL when resolving the consent binding — but only on the approve/deny POST, and
 * only through `resolveIdentityBinding`'s cookie fallback (the mount primes a null
 * identity once `authHandle` has cleared the lapsed session).
 *
 * Coverage is deliberately layered so this file proves the mounted-surface wiring
 * without re-testing what its siblings own:
 * - `auth/neon-session.test.ts` proves the real jose `clockTolerance` behaviour
 *   (expired-within-grace accepted, beyond-grace and bad-signature rejected).
 * - `identity.test.ts` proves the leeway is scoped to POST (600s) vs GET (none).
 * - THIS file proves that, on the real mount, an approve/deny POST whose identity
 *   resolves only through the cookie fallback completes the grant (approve → 302
 *   with a code; deny → access_denied) and that a request with no session cookie
 *   is still refused — so the grace opens no path for a bypass session, which
 *   sets no Neon Auth cookie (TRI-45). The JWKS-backed token verification is the
 *   one thing that cannot run without a network JWKS endpoint, so it is stubbed
 *   here; its real behaviour lives in the neon-session suite above.
 *
 * The manually-set `Cookie` header below is faithful to a real browser rather
 * than a mask: `setNeonAuthTokenCookie` retains the cookie past the JWT's exp by
 * exactly this grace window (`neonAuthConsentGraceSeconds`), so the browser still
 * holds and sends the lapsed token on the POST — asserted in `neon-session.test.ts`.
 */

const validateNeonSessionFromToken = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/auth/neon-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/auth/neon-session')>();
  return { ...actual, validateNeonSessionFromToken };
});

const BASE = mcpBaseUrl.origin;
const ISSUER = mcpIssuer;
const RESOURCE = mcpResourceUrl.href;
const CLIENT_ID = 'consent-jwt-expiry-client';
const REDIRECT_URI = 'https://client.example/callback';
const CODE_CHALLENGE = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
// A real-looking but here-unverified token string: the stubbed validator decides
// its fate, standing in for a JWT that lapsed during the consent window.
const EXPIRED_TOKEN = 'expired.but.recent';

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'consent-jwt-user', email: 'c@example.com', name: 'Consent User' })
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
    clientName: 'Consent JWT Expiry Client',
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

afterEach(() => {
  validateNeonSessionFromToken.mockReset();
});

/** A resolved session for the mapped application user (a within-grace JWT). */
function resolvesToUser() {
  validateNeonSessionFromToken.mockResolvedValue({
    user: applicationUser,
    neonSession: { neonAuthUserId: 'neon-sub', expiresAt: new Date() },
  });
}

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

function extractField(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`name="${escaped}"[^>]*\\bvalue="([^"]*)"`));
  if (!match) throw new Error(`field ${name} not found in consent HTML`);
  return match[1]!;
}

/**
 * Drives a valid authorize GET with a primed (still-valid) identity and returns
 * the transaction the consent form posts back. The transaction binds to the
 * application user, exactly as it does when the JWT is still live at render time.
 */
async function mintTransaction(): Promise<{ transactionId: string; csrfToken: string }> {
  const consent = await runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(new Request(authorizeUrl()), { user: applicationUser }),
  );
  const html = await consent.text();
  return {
    transactionId: extractField(html, 'transaction_id'),
    csrfToken: extractField(html, 'csrf_token'),
  };
}

/**
 * Posts to an approve/deny path with a null primed identity (the lapsed session
 * `authHandle` leaves behind) and an optional session cookie carrying the
 * expired token, forcing the mount through the `resolveIdentityBinding` fallback.
 */
function consentPost(path: string, body: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'sec-fetch-site': 'same-origin',
  };
  if (cookie) headers.cookie = `${neonAuthTokenCookieName}=${cookie}`;
  return fixture.handle(new Request(`${BASE}${path}`, { method: 'POST', headers, body }), {
    user: null,
  });
}

describe('consent POST after the JWT has expired (TRI-122)', () => {
  it('completes the grant on approve, resolving identity from the expired cookie', async () => {
    resolvesToUser();
    const { transactionId, csrfToken } = await mintTransaction();

    const response = await consentPost(
      '/oauth/authorize/approve',
      `transaction_id=${transactionId}&csrf_token=${csrfToken}`,
      EXPIRED_TOKEN,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('code')).not.toBeNull();
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
    // The grace is applied on the surface: the POST verifies with the 10-minute
    // transaction TTL of exp leeway, not strictly.
    expect(validateNeonSessionFromToken).toHaveBeenCalledWith(EXPIRED_TOKEN, {
      clockToleranceSeconds: 600,
    });
  });

  it('routes deny to access_denied — never a /login bounce — after expiry', async () => {
    resolvesToUser();
    const { transactionId, csrfToken } = await mintTransaction();

    const response = await consentPost(
      '/oauth/authorize/deny',
      `transaction_id=${transactionId}&csrf_token=${csrfToken}`,
      EXPIRED_TOKEN,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('refuses an approve with no session cookie, so grace opens no bypass path (TRI-45)', async () => {
    resolvesToUser();
    const { transactionId, csrfToken } = await mintTransaction();

    // A dev-auth-bypass session sets no Neon Auth cookie, so the fallback has no
    // token to grant leeway to: the validator is never consulted and no code is
    // issued.
    const response = await consentPost(
      '/oauth/authorize/approve',
      `transaction_id=${transactionId}&csrf_token=${csrfToken}`,
    );

    expect(
      response.headers.get('location') &&
        new URL(response.headers.get('location')!).searchParams.get('code'),
    ).toBeFalsy();
    expect(validateNeonSessionFromToken).not.toHaveBeenCalled();
  });
});
