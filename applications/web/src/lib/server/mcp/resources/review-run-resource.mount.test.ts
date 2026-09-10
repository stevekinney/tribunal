import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { mcpBaseUrl, mcpResourceUrl } from '$lib/server/oauth/configuration';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';
import { REVIEW_RUNS_RESOURCE_URI } from '../resource-updates';

/**
 * Proves the review-runs resource is served through Tribunal's real mount and
 * that adding it flips the modern era's advertised `resources.subscribe`
 * capability (TRI-126). The end-to-end subscribe → `notifications/resources/
 * updated` delivery over SSE is TRI-43's AC3; here a modern SDK client connects,
 * inspects capabilities, and reads the resource (both close, so no long-lived
 * stream is held).
 */

const BASE = mcpBaseUrl.origin;
const RESOURCE = mcpResourceUrl.href;
const REDIRECT_URI = 'https://client.example/callback';
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const MODERN_ERA = '2026-07-28';

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;
let accessToken: string;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function mintAccessToken(scope = 'reviews:read'): Promise<string> {
  const registration = await fixture.handle(
    new Request(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Resource Verify Client',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
      }),
    }),
  );
  const clientId = ((await registration.json()) as { client_id: string }).client_id;
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
    fixture.handle(new Request(authorizeUrl), { user: applicationUser }),
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
    { user: applicationUser },
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

async function connectModernClient(token = accessToken): Promise<Client> {
  const client = new Client(
    { name: 'tri-126-resource-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MODERN_ERA } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    fetch: (input, init) => {
      const request = new Request(input, init);
      request.headers.set('authorization', `Bearer ${token}`);
      return runWithDatabase(fixture.database.db as never, () => fixture.handle(request));
    },
  });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'resource-user', email: 'r@example.com', name: 'Resource User' })
    .returning();
  applicationUser = {
    id: row!.id,
    username: row!.username,
    name: row!.name,
    avatarUrl: row!.avatarUrl,
    email: row!.email,
    isPlatformAdministrator: row!.isPlatformAdministrator,
  };
  accessToken = await mintAccessToken();
});

afterAll(async () => {
  await fixture.dispose();
});

describe('review-runs resource through the mount (TRI-126)', () => {
  it('advertises resources.subscribe to a modern client now that a resource exists', async () => {
    const client = await connectModernClient();
    try {
      expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('serves resources/read for the review-runs resource as a JSON document', async () => {
    const client = await connectModernClient();
    try {
      const result = await client.readResource({ uri: REVIEW_RUNS_RESOURCE_URI });
      const content = result.contents[0]!;
      expect(content.uri).toBe(REVIEW_RUNS_RESOURCE_URI);
      expect(content.mimeType).toBe('application/json');
      // The seeded user has no runs yet, so the collection reads as an empty page.
      const parsed = JSON.parse((content as { text: string }).text) as {
        runs: unknown[];
        hasMore: boolean;
      };
      expect(parsed.runs).toEqual([]);
      expect(parsed.hasMore).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('lists the review-runs resource in resources/list', async () => {
    const client = await connectModernClient();
    try {
      const listed = await client.listResources();
      expect(listed.resources.map((resource) => resource.uri)).toContain(REVIEW_RUNS_RESOURCE_URI);
    } finally {
      await client.close();
    }
  });

  it('rejects resources/read for a token that lacks reviews:read (engine enforces resource scope)', async () => {
    // The original tools-only decision assumed the engine could not authorize a
    // resource read for a consumer. It can: the published serving handler gates
    // resources/read on the resource's requiredScope exactly as it gates
    // tools/call. A token granted only repositories:read must be refused.
    const underScopedToken = await mintAccessToken('repositories:read');
    const client = await connectModernClient(underScopedToken);
    try {
      await expect(client.readResource({ uri: REVIEW_RUNS_RESOURCE_URI })).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it('exposes the runtime publisher the review layer uses, reaching the handler without error', () => {
    // The producer (operator.stopRun → notifyReviewRunsChanged → this publisher)
    // reaches handler.publishUserResourceUpdate. With no live subscription it is a
    // no-op, but the call must not throw — the review layer fires it inline.
    expect(() =>
      fixture.publishUserResourceUpdate(String(applicationUser.id), REVIEW_RUNS_RESOURCE_URI),
    ).not.toThrow();
  });
});
