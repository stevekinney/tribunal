import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * Verifies the library's authorize/approve/deny handlers against Tribunal's
 * mounted surface (TRI-37). The handlers live in `@lostgradient/mcp`; these
 * tests prove they are correctly wired — Tribunal's issuer and resource URL are
 * the ones enforced, the mount routes the paths, and the security behaviours
 * hold end to end. The mounted-surface fixture is imported from the mount issue
 * (TRI-41), not reimplemented (AC5).
 *
 * `resolveUserProfile` reads the app `db` singleton, and only the authorize GET
 * reaches it (approve and deny do not), so the GET helpers run inside
 * `runWithDatabase` to route that read to the same PGlite instance the stores
 * use; the approve/deny POSTs need no wrapper.
 */

const BASE = 'http://localhost:5173';
const ISSUER = 'http://localhost:5173';
const RESOURCE = 'http://localhost:5173/mcp';
const CLIENT_ID = 'authorize-verify-client';
const REDIRECT_URI = 'https://client.example/callback';
const LOOPBACK_REGISTERED = 'http://127.0.0.1:8080/callback';
// A valid PKCE S256 challenge: 43 base64url characters.
const CODE_CHALLENGE = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'authorize-user', email: 'a@example.com', name: 'Authorize User' })
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
    clientName: 'Authorize Verify Client',
    clientType: 'public',
    tokenEndpointAuthMethod: 'none',
    applicationType: 'native',
    redirectUris: [REDIRECT_URI, LOOPBACK_REGISTERED],
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

function authorizeUrl(overrides: Record<string, string | null> = {}): string {
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
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `${BASE}/oauth/authorize?${params.toString()}`;
}

/** Runs an authorize GET (which reaches resolveUserProfile) with the app db routed to PGlite. */
function getAuthorize(url: string): Promise<Response> {
  return runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(new Request(url), { user: applicationUser }),
  );
}

function formPost(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

function extractField(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Allow other attributes between name and value rather than assuming order.
  const match = html.match(new RegExp(`name="${escaped}"[^>]*\\bvalue="([^"]*)"`));
  if (!match) throw new Error(`field ${name} not found in consent HTML`);
  return match[1]!;
}

/** Drives a valid authorize GET and returns the live transaction's approve/deny fields. */
async function mintTransaction(): Promise<{ transactionId: string; csrfToken: string }> {
  const consent = await getAuthorize(authorizeUrl());
  const html = await consent.text();
  return {
    transactionId: extractField(html, 'transaction_id'),
    csrfToken: extractField(html, 'csrf_token'),
  };
}

describe('authorize path — handlers respond through the mount (behaviour 1)', () => {
  it('serves the consent prompt for a valid authorize request', async () => {
    const response = await getAuthorize(authorizeUrl());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('name="transaction_id"');
    expect(html).toContain('name="csrf_token"');
  });

  it('routes deny to an access_denied redirect carrying state and iss', async () => {
    const { transactionId, csrfToken } = await mintTransaction();
    const response = await fixture.handle(
      formPost('/oauth/authorize/deny', `transaction_id=${transactionId}&csrf_token=${csrfToken}`, {
        'sec-fetch-site': 'same-origin',
      }),
      { user: applicationUser },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
    // Distinguishes deny from approve: no authorization code is issued.
    expect(location.searchParams.get('code')).toBeNull();
  });
});

describe('authorize path — RFC 8707 resource + RFC 9207 iss (behaviours 2, 3)', () => {
  it('rejects a mismatched resource with invalid_target on an iss-carrying redirect', async () => {
    const response = await fixture.handle(
      new Request(authorizeUrl({ resource: 'http://localhost:5173/wrong' })),
      { user: applicationUser },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('invalid_target');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });

  it('carries iss on an invalid_scope error redirect', async () => {
    const response = await fixture.handle(
      new Request(authorizeUrl({ scope: 'not-a-real-scope' })),
      { user: applicationUser },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('invalid_scope');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });
});

describe('authorize path — redirect-URI matching (behaviour 4)', () => {
  it('rejects an unregistered redirect_uri with a direct error, not a redirect', async () => {
    const response = await fixture.handle(
      new Request(authorizeUrl({ redirect_uri: 'https://evil.example/callback' })),
      { user: applicationUser },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('Invalid redirect URI');
  });

  it('accepts a loopback redirect_uri on a different port than registered', async () => {
    // Registered http://127.0.0.1:8080/callback; request a different port.
    const response = await getAuthorize(
      authorizeUrl({ redirect_uri: 'http://127.0.0.1:9999/callback' }),
    );
    // Port-flexible match means it passes redirect validation and reaches consent.
    expect(response.status).toBe(200);
  });
});

describe('authorize path — CSRF/origin gate precedes body parsing (behaviour 5)', () => {
  it('rejects a cross-site approve BEFORE parsing the body', async () => {
    // The body exceeds the 4 KiB parse cap: if the handler read the body before
    // checking the origin, this would be 413 (payload too large). A 403 proves
    // the cross-site rejection happens first, before the body is consumed.
    const oversizedBody = `transaction_id=${'a'.repeat(5000)}&csrf_token=b`;
    const response = await fixture.handle(
      formPost('/oauth/authorize/approve', oversizedBody, { 'sec-fetch-site': 'cross-site' }),
      { user: applicationUser },
    );
    expect(response.status).toBe(403);
  });

  it('passes the gate for a same-origin request and fails later on an invalid transaction', async () => {
    const response = await fixture.handle(
      formPost('/oauth/authorize/approve', 'transaction_id=missing&csrf_token=missing', {
        'sec-fetch-site': 'same-origin',
      }),
      { user: applicationUser },
    );
    expect(response.status).toBe(400);
  });
});

describe('authorize path — transaction is single-use through the mount (behaviour 6)', () => {
  // Proves the wired approve flow consumes a transaction only once: a second
  // approve of the same transaction is rejected, and a successful approve
  // issues a code+iss redirect. The library's consume is a single conditional
  // `UPDATE ... WHERE consumed_at IS NULL RETURNING`; proving that atomic under
  // genuinely concurrent database sessions belongs to the library's own suite
  // against real PostgreSQL — one in-process PGlite serializes SQL, so a test
  // here could not distinguish a race-prone read-then-write.
  it('rejects a second approve and issues a code on the first', async () => {
    const { transactionId, csrfToken } = await mintTransaction();
    const body = `transaction_id=${transactionId}&csrf_token=${csrfToken}`;
    const headers = { 'sec-fetch-site': 'same-origin' };

    const first = await fixture.handle(formPost('/oauth/authorize/approve', body, headers), {
      user: applicationUser,
    });
    const second = await fixture.handle(formPost('/oauth/authorize/approve', body, headers), {
      user: applicationUser,
    });

    expect(first.status).toBe(302);
    const location = new URL(first.headers.get('location')!);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('iss')).toBe(ISSUER);
    expect(second.status).toBe(400);
  });
});

describe('authorize path — response headers (AC3)', () => {
  it('serves the consent HTML with no-store, private and Vary: Cookie', async () => {
    const response = await getAuthorize(authorizeUrl());
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    // Vary must include Cookie; it may carry other values (the decorator appends).
    expect(
      response.headers
        .get('vary')
        ?.split(',')
        .map((value) => value.trim()),
    ).toContain('Cookie');
  });
});
