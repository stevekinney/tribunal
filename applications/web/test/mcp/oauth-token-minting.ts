import { expect } from 'vitest';
import { mcpBaseUrl, mcpResourceUrl } from '$lib/server/oauth/configuration';
import { runWithDatabase } from '$lib/server/database';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';
import type { McpMountFixture } from '$testing/mcp/mount-fixture';

/**
 * Shared OAuth minting for the mounted-surface suites. The real authorize →
 * approve → token exchange is the only way to obtain a bearer the mount's
 * eight-step authentication accepts, and more than one suite needs it (the
 * transport verification and the request-bounds verification both authenticate
 * before they can reach the behaviour they test). Extracted here rather than
 * duplicated so the PKCE pair, the resource audience, and the consent-field
 * scraping stay defined once.
 */

const BASE = mcpBaseUrl.origin;
const RESOURCE = mcpResourceUrl.href;
const REDIRECT_URI = 'https://client.example/callback';
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/**
 * Registers one public OAuth client and returns its id. Registration is rate
 * limited per IP and every request here is 127.0.0.1, so a suite registers once
 * and reuses the id across every mint.
 */
export async function registerOAuthClient(fixture: McpMountFixture): Promise<string> {
  const registration = await fixture.handle(
    new Request(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Request Bounds Client',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
      }),
    }),
  );
  expect(registration.status).toBe(201);
  const clientId = ((await registration.json()) as { client_id?: string }).client_id;
  expect(clientId).toBeTruthy();
  return clientId!;
}

/**
 * Mints an access token for `forUser` with `scope` through the real authorize →
 * approve → token flow, reusing an already-registered `clientId`.
 */
export async function mintAccessToken(
  fixture: McpMountFixture,
  scope: string,
  forUser: AuthenticatedApplicationUser,
  clientId: string,
): Promise<string> {
  const authorizeUrl = `${BASE}/oauth/authorize?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    scope,
    state: 'xyz',
  }).toString()}`;
  const consent = await runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(new Request(authorizeUrl), { user: forUser }),
  );
  const html = await consent.text();
  const field = (name: string): string => {
    const match = html.match(new RegExp(`name="${name}"[^>]*\\bvalue="([^"]*)"`));
    if (!match) throw new Error(`field ${name} not found in consent HTML`);
    return match[1]!;
  };
  const approved = await fixture.handle(
    new Request(`${BASE}/oauth/authorize/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
      },
      body: form({ transaction_id: field('transaction_id'), csrf_token: field('csrf_token') }),
    }),
    { user: forUser },
  );
  const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
  const tokenResponse = await fixture.handle(
    new Request(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
        resource: RESOURCE,
      }),
    }),
  );
  return ((await tokenResponse.json()) as { access_token: string }).access_token;
}
