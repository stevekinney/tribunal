import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { mcpBaseUrl, mcpResourceUrl } from '$lib/server/oauth/configuration';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * Verifies the library's token, revoke, and dynamic-registration handlers
 * against Tribunal's mounted surface (TRI-38). The handlers live in
 * `@lostgradient/mcp`; Tribunal implements none of them (asserted by `rg` in the
 * pull request body). These tests prove the handlers are correctly wired —
 * Tribunal's resource URL is the one enforced, PKCE and client authentication
 * hold end to end, and refresh rotation/family revocation behave against
 * Tribunal's own PGlite-backed stores. The mounted-surface fixture is imported
 * from the mount issue (TRI-41), not reimplemented (AC5).
 *
 * The authorize GET reaches `resolveUserProfile`, which reads the app `db`
 * singleton, so GET helpers run inside `runWithDatabase`; POSTs to token/revoke/
 * register do not touch that path and need no wrapper.
 */

const BASE = mcpBaseUrl.origin;
const RESOURCE = mcpResourceUrl.href;
const REDIRECT_URI = 'https://client.example/callback';
// A valid PKCE S256 pair: verifier and its base64url-SHA256 challenge (RFC 7636 §4).
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;
let publicClientId: string;

async function registerClient(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fixture.handle(
    new Request(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const parsed = (await response.json()) as Record<string, unknown>;
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`registration failed (${response.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function tokenRequest(fields: Record<string, string>): Promise<Response> {
  return fixture.handle(
    new Request(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form(fields),
    }),
  );
}

function authorizeUrl(clientId: string, overrides: Record<string, string | null> = {}): string {
  const params = new URLSearchParams({
    client_id: clientId,
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

function extractField(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`name="${escaped}"[^>]*\\bvalue="([^"]*)"`));
  if (!match) throw new Error(`field ${name} not found in consent HTML`);
  return match[1]!;
}

/**
 * Drives authorize → approve for `clientId` and returns the issued authorization
 * code. `resource`/`scope` override the authorize request so a token grant can
 * be checked against the same or a different resource.
 */
async function mintCode(
  clientId: string,
  overrides: Record<string, string | null> = {},
): Promise<string> {
  const consent = await getAuthorize(authorizeUrl(clientId, overrides));
  const html = await consent.text();
  const transactionId = extractField(html, 'transaction_id');
  const csrfToken = extractField(html, 'csrf_token');
  const approved = await fixture.handle(
    new Request(`${BASE}/oauth/authorize/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
      },
      body: form({ transaction_id: transactionId, csrf_token: csrfToken }),
    }),
    { user: applicationUser },
  );
  const location = new URL(approved.headers.get('location')!);
  const code = location.searchParams.get('code');
  if (!code) throw new Error(`approve did not issue a code: ${location.href}`);
  return code;
}

type TokenGrant = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
};

/** Exchanges an authorization code for a token grant on the public PKCE client. */
async function exchangeCode(
  code: string,
  overrides: Record<string, string> = {},
): Promise<{ status: number; body: TokenGrant & { error?: string } }> {
  const response = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: publicClientId,
    code_verifier: CODE_VERIFIER,
    resource: RESOURCE,
    ...overrides,
  });
  return {
    status: response.status,
    body: (await response.json()) as TokenGrant & { error?: string },
  };
}

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'token-user', email: 't@example.com', name: 'Token User' })
    .returning();
  applicationUser = {
    id: row!.id,
    username: row!.username,
    name: row!.name,
    avatarUrl: row!.avatarUrl,
    email: row!.email,
    isPlatformAdministrator: row!.isPlatformAdministrator,
  };
  // A public (PKCE, no secret) client for the authorization-code flow.
  const publicClient = await registerClient({
    client_name: 'Token Verify Public Client',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  });
  publicClientId = publicClient.client_id as string;
});

afterAll(async () => {
  await fixture.dispose();
});

describe('token endpoint — client authentication choke point (behaviour 4)', () => {
  it('rejects a confidential client whose secret has expired with invalid_client', async () => {
    // Regression proof for @lostgradient/mcp 0.2.2: on 0.2.1 the Postgres stores
    // read clientSecretExpiresAt back as a string, so the expiry check's
    // `.getTime()` crashed (500) on every confidential-client token request.
    // 0.2.2 coerces it to Date and returns a clean invalid_client.
    const confidential = await registerClient({
      client_name: 'Expired Secret Client',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      application_type: 'web',
    });
    const clientId = confidential.client_id as string;
    const clientSecret = confidential.client_secret as string;
    expect(clientSecret).toBeTruthy();

    // Backdate the secret expiry through the same stores the mount reads.
    await fixture.stores.clients.update(clientId, {
      clientSecretExpiresAt: new Date(Date.now() - 60_000),
    });

    // Client authentication (and its expiry check) precedes grant validation, so
    // a dummy code still surfaces invalid_client rather than invalid_grant.
    const response = await tokenRequest({
      grant_type: 'authorization_code',
      code: 'irrelevant-the-client-is-rejected-first',
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: CODE_VERIFIER,
      resource: RESOURCE,
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe('invalid_client');
  });

  it('rejects a client_secret sent by a public (none-auth) client', async () => {
    // The public client registered with token_endpoint_auth_method: 'none'.
    // Presenting a secret it never has is a client-authentication error, not a
    // silently-ignored field.
    const code = await mintCode(publicClientId);
    const response = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: publicClientId,
      client_secret: 'a-secret-the-none-auth-client-does-not-have',
      code_verifier: CODE_VERIFIER,
      resource: RESOURCE,
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: string }).error).toBe('invalid_client');
  });
});

describe('token + revoke + registration handlers respond through the mount (behaviour 1)', () => {
  it('exchanges an authorization code for a Bearer access + refresh token', async () => {
    const code = await mintCode(publicClientId);
    const { status, body } = await exchangeCode(code);
    expect(status).toBe(200);
    expect(body.token_type.toLowerCase()).toBe('bearer');
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it('answers the revoke endpoint (RFC 7009 always-200) for an issued token', async () => {
    const code = await mintCode(publicClientId);
    const { body } = await exchangeCode(code);
    const response = await fixture.handle(
      new Request(`${BASE}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ token: body.refresh_token!, client_id: publicClientId }),
      }),
    );
    // RFC 7009: the revoke endpoint returns 200 whether or not the token existed.
    expect(response.status).toBe(200);
  });
});

describe('token endpoint — PKCE S256 is enforced at exchange (behaviour 2)', () => {
  it('rejects a code exchanged with the wrong code_verifier as invalid_grant', async () => {
    // The negative that proves PKCE is actually checked: a valid code with a
    // verifier that does not hash to the registered challenge is refused.
    const code = await mintCode(publicClientId);
    const { status, body } = await exchangeCode(code, {
      code_verifier: 'wrong-verifier-that-does-not-match-the-s256-challenge-000',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_grant');
  });

  it('requires S256, refusing an authorize request that asks for the plain method', async () => {
    // Discriminating for S256 *enforcement* rather than mere challenge-length
    // validation: a valid-length challenge presented with code_challenge_method=
    // plain must still be refused, so no code is issued.
    const response = await fixture.handle(
      new Request(authorizeUrl(publicClientId, { code_challenge_method: 'plain' })),
      {
        user: applicationUser,
      },
    );
    // Either a direct 400 or an error redirect — both refuse to issue a code.
    if (response.status === 302) {
      const location = new URL(response.headers.get('location')!);
      expect(location.searchParams.get('code')).toBeNull();
      expect(location.searchParams.get('error')).toBeTruthy();
    } else {
      expect(response.status).toBe(400);
    }
  });
});

describe('dynamic client registration — RFC 7591 (behaviour 6)', () => {
  it('registers a client with no rate limiter injected and echoes the RFC 7591 metadata', async () => {
    // The fixture wires no registration rate limiter (that seam is optional and
    // Tribunal does not supply one yet — TRI-56), so a bare registration must
    // succeed. A confidential registration returns a generated client_secret and
    // the RFC 7591 issued-at / auth-method metadata.
    const registered = await registerClient({
      client_name: 'RFC 7591 Client',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      application_type: 'web',
    });
    expect(registered.client_id).toBeTruthy();
    expect(registered.client_secret).toBeTruthy();
    expect(registered.token_endpoint_auth_method).toBe('client_secret_post');
    expect(typeof registered.client_id_issued_at).toBe('number');
    expect(registered.redirect_uris).toEqual([REDIRECT_URI]);
  });

  it('rejects a registration whose redirect_uri is not a valid absolute URI', async () => {
    const response = await fixture.handle(
      new Request(`${BASE}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Bad Redirect Client',
          redirect_uris: ['not-a-uri'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
    expect(response.status).toBe(400);
    // The library reports a malformed redirect_uri at registration under
    // RFC 7591's invalid_client_metadata rather than invalid_redirect_uri.
    expect(((await response.json()) as { error?: string }).error).toBe('invalid_client_metadata');
  });
});

describe('token endpoint — refresh rotation invalidates the prior token (behaviour 7)', () => {
  it('rotates the refresh token and refuses the prior one', async () => {
    const code = await mintCode(publicClientId);
    const { body: first } = await exchangeCode(code);
    expect(first.refresh_token).toBeTruthy();

    // Rotate: exchange the refresh token for a new grant.
    const rotated = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: publicClientId,
      resource: RESOURCE,
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as TokenGrant;
    expect(rotatedBody.refresh_token).toBeTruthy();
    expect(rotatedBody.refresh_token).not.toBe(first.refresh_token);

    // The prior refresh token is now invalid — replaying it is refused.
    const replay = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: publicClientId,
      resource: RESOURCE,
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error?: string }).error).toBe('invalid_grant');
  });
});

/**
 * Presents a bearer access token to the mounted `/mcp` surface. A rejected token
 * 401s before any JSON-RPC processing, so a minimal `initialize` body is enough
 * to distinguish an accepted token (not 401) from a revoked one (401). The
 * streamable-HTTP transport requires the text/event-stream accept type, and
 * identity resolution reads the app db singleton, so this wraps `runWithDatabase`
 * the same way the authorize GET does.
 */
function callMcp(accessToken: string): Promise<Response> {
  return runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(
      new Request(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'tri-38-token-verify', version: '0' },
          },
        }),
      }),
    ),
  );
}

describe('token endpoint — RFC 8707 resource binding (behaviour 3)', () => {
  it('rejects an authorization_code grant whose resource does not match with invalid_target', async () => {
    // The resource is validated at the token grant against Tribunal's own
    // resource URL; a mismatch is invalid_target, distinct from invalid_grant.
    const code = await mintCode(publicClientId);
    const { status, body } = await exchangeCode(code, {
      resource: new URL('/not-the-mcp-resource', mcpBaseUrl).href,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_target');
  });

  it('issues a token bound to Tribunal’s resource that authenticates at /mcp', async () => {
    const code = await mintCode(publicClientId);
    const { body } = await exchangeCode(code);
    const response = await callMcp(body.access_token);
    // The binding is accepted: the request is authenticated (anything but 401).
    // Cross-resource rejection (a token minted for a different resource) is the
    // library’s own suite’s concern — Tribunal exposes a single resource.
    expect(response.status).not.toBe(401);
  });
});

describe('token endpoint — refresh replay revokes the whole family (behaviour 5)', () => {
  it('makes an access token from a replayed family unusable at /mcp, not just the refresh', async () => {
    const code = await mintCode(publicClientId);
    const { body: first } = await exchangeCode(code);

    // Rotate the refresh token. This library revokes the prior access token on
    // rotation, so the rotated access token — not the original — is the one still
    // valid, and is the controlled subject the replay must then revoke.
    const rotated = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: publicClientId,
      resource: RESOURCE,
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as TokenGrant;
    expect(rotatedBody.refresh_token).not.toBe(first.refresh_token);

    // The rotated access token works at /mcp before the replay, so the 401 after
    // it proves the replay revoked a still-valid token rather than one that never
    // worked or that rotation had already invalidated.
    expect((await callMcp(rotatedBody.access_token)).status).not.toBe(401);

    // Replay the now-consumed prior refresh token: reuse detection revokes the
    // entire token family.
    const replay = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: publicClientId,
      resource: RESOURCE,
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error?: string }).error).toBe('invalid_grant');

    // The core claim: the access token minted from the replayed family is now
    // unusable at /mcp — the family's access tokens are revoked, not only its
    // refresh tokens.
    expect((await callMcp(rotatedBody.access_token)).status).toBe(401);
  });
});
