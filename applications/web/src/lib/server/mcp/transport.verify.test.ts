import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { mcpBaseUrl, mcpResourceUrl } from '$lib/server/oauth/configuration';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * Verifies the MCP HTTP transport at `/mcp` through Tribunal's mounted surface
 * (TRI-43). The transport, both protocol eras, the per-user handler cache, and
 * the eight-step authentication order all live in `@lostgradient/mcp`; these
 * tests prove they survive SvelteKit's hook chain and adapter-node getting
 * between the client and the handler. The mounted-surface fixture is imported
 * from the mount issue (TRI-41), not reimplemented.
 *
 * Streaming rule: a `subscriptions/listen` response never ends (a 15s keep-alive
 * interval keeps it open), so those tests read one chunk and abort — they never
 * `await response.text()`. Ordinary request/response messages (initialize,
 * subscribe, a single tool call) do close, so their bodies are read in full.
 */

const BASE = mcpBaseUrl.origin;
const RESOURCE = mcpResourceUrl.href;
const REDIRECT_URI = 'https://client.example/callback';
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const MODERN_ERA = '2026-07-28';
const LEGACY_ERA = '2025-11-25';

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;
let accessToken: string;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** Mints an access token through the real authorize → approve → token flow. */
async function mintAccessToken(): Promise<string> {
  const registration = await fixture.handle(
    new Request(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Transport Verify Client',
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
    scope: 'repositories:read',
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

type McpRequestOptions = {
  era?: string;
  token?: string | null;
  origin?: string | null;
  headers?: Record<string, string>;
};

/** POSTs a JSON-RPC message to /mcp, authenticated unless token is overridden. */
function mcpRequest(message: unknown, options: McpRequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...options.headers,
  };
  const token = options.token === undefined ? accessToken : options.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (options.origin != null) headers.origin = options.origin;
  return runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(
      new Request(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(message) }),
    ),
  );
}

function initializeMessage(era: string): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: era,
      capabilities: {},
      clientInfo: { name: 'tri-43-transport', version: '0' },
    },
  };
}

/**
 * Connects a real MCP SDK client to `/mcp` through the mount, so the era's own
 * handshake envelope (legacy `initialize`, or the modern claim) is formed by the
 * SDK rather than hand-rolled. The transport's `fetch` adds the bearer token and
 * routes each request through the fixture handle inside `runWithDatabase` (the
 * `/mcp` identity resolution reads the app db). Modern is entered by pinning the
 * version; legacy is the default negotiation. Always `close()` the returned
 * client — its transport holds an open connection.
 */
async function connectClient(
  era: 'modern' | 'legacy',
  token: string = accessToken,
): Promise<Client> {
  const client = new Client(
    { name: 'tri-43-transport-client', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: MODERN_ERA } } } : undefined,
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
    .values({ username: 'transport-user', email: 'tr@example.com', name: 'Transport User' })
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

describe('MCP transport — both protocol eras through the mount (behaviour 1)', () => {
  it('negotiates the modern era and advertises resources.subscribe', async () => {
    const client = await connectClient('modern');
    try {
      expect(client.getProtocolEra()).toBe('modern');
      // TRI-126 added the tribunal://review-runs resource, so the modern era now
      // advertises the resources capability with subscribe support (AC1). The
      // through-mount grant/refusal of resources/read is proven in
      // review-run-resource.mount.test.ts; here we assert the era negotiation
      // surfaces the capability at all.
      expect(client.getServerCapabilities()?.tools).toBeDefined();
      expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('negotiates the legacy era, which does not advertise resource subscription', async () => {
    const client = await connectClient('legacy');
    try {
      expect(client.getProtocolEra()).toBe('legacy');
      expect(client.getServerCapabilities()?.resources?.subscribe).not.toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('MCP transport — Origin handling (behaviour 5)', () => {
  it('accepts an authenticated request with no Origin header (most MCP clients are not browsers)', async () => {
    // A legacy initialize (no modern header, so the handshake and header agree)
    // carrying no Origin must not be rejected by the localhost/origin gate.
    const response = await mcpRequest(initializeMessage(LEGACY_ERA), { origin: null });
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(200);
  });
});
