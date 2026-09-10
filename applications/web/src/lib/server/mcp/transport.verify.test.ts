import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { mcpBaseUrl, mcpResourceUrl, mcpRuntimeLimits } from '$lib/server/oauth/configuration';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';
import { REVIEW_RUNS_RESOURCE_URI } from '$lib/server/mcp/resource-updates';
import { hashWithSha256 } from '$lib/server/encryption';

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
let secondUser: AuthenticatedApplicationUser;
let accessToken: string;
let reviewsToken: string;
let secondReviewsToken: string;
let registeredClientId: string;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/**
 * Registers one public OAuth client and returns its id. Registration is rate
 * limited (oauth_register, 5/60 per IP) and every request here is 127.0.0.1, so
 * the suite registers once in beforeAll and reuses the id across every mint.
 */
async function registerClient(): Promise<string> {
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
  return ((await registration.json()) as { client_id: string }).client_id;
}

/**
 * Mints an access token for `forUser` with `scope` through the real authorize →
 * approve → token flow, reusing an already-registered `clientId`.
 */
async function mintAccessToken(
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

type McpRequestOptions = {
  era?: string;
  token?: string | null;
  origin?: string | null;
  headers?: Record<string, string>;
  clientAddress?: string;
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
      options.clientAddress ? { clientAddress: options.clientAddress } : undefined,
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

function toApplicationUser(row: typeof user.$inferSelect): AuthenticatedApplicationUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatarUrl,
    email: row.email,
    isPlatformAdministrator: row.isPlatformAdministrator,
  };
}

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [rowA] = await fixture.database.db
    .insert(user)
    .values({ username: 'transport-user', email: 'tr@example.com', name: 'Transport User' })
    .returning();
  const [rowB] = await fixture.database.db
    .insert(user)
    .values({ username: 'transport-user-b', email: 'trb@example.com', name: 'Transport User B' })
    .returning();
  applicationUser = toApplicationUser(rowA!);
  secondUser = toApplicationUser(rowB!);

  registeredClientId = await registerClient();
  accessToken = await mintAccessToken('repositories:read', applicationUser, registeredClientId);
  reviewsToken = await mintAccessToken('reviews:read', applicationUser, registeredClientId);
  secondReviewsToken = await mintAccessToken('reviews:read', secondUser, registeredClientId);
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

describe('MCP transport — modern resource-update delivery (behaviour 3)', () => {
  it('delivers a real notifications/resources/updated to a modern subscriber', async () => {
    const client = await connectClient('modern', reviewsToken);
    const received: { method: string; params?: { uri?: string } }[] = [];
    client.fallbackNotificationHandler = async (notification) => {
      received.push(notification as { method: string; params?: { uri?: string } });
    };
    try {
      // listen() opens the modern subscriptions/listen stream (the _meta envelope
      // is formed by the SDK; a raw modern POST is a deliberate 400 without it).
      const subscription = await client.listen({
        resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI],
      } as never);
      try {
        // The listen established this user's handler; publish AFTER it is open.
        fixture.publishUserResourceUpdate(String(applicationUser.id), REVIEW_RUNS_RESOURCE_URI);
        await vi.waitFor(
          () => {
            const update = received.find(
              (notification) => notification.method === 'notifications/resources/updated',
            );
            expect(update?.params?.uri).toBe(REVIEW_RUNS_RESOURCE_URI);
          },
          { timeout: 4000 },
        );
      } finally {
        await subscription.close();
      }
    } finally {
      await client.close();
    }
  });
});

describe('MCP transport — one handler per user survives the mount (behaviour 6)', () => {
  it('never delivers a resource update across users (one handler per user)', async () => {
    const clientA = await connectClient('modern', reviewsToken);
    const clientB = await connectClient('modern', secondReviewsToken);
    const receivedA: { method: string }[] = [];
    const receivedB: { method: string }[] = [];
    clientA.fallbackNotificationHandler = async (n) => {
      receivedA.push(n as { method: string });
    };
    clientB.fallbackNotificationHandler = async (n) => {
      receivedB.push(n as { method: string });
    };
    let subA: Awaited<ReturnType<typeof clientA.listen>> | undefined;
    let subB: Awaited<ReturnType<typeof clientB.listen>> | undefined;
    try {
      subA = await clientA.listen({ resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI] } as never);
      subB = await clientB.listen({ resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI] } as never);

      // Publish for A only. A shared handler would leak this to B — a confirmed
      // cross-user disclosure, so B must receive nothing.
      fixture.publishUserResourceUpdate(String(applicationUser.id), REVIEW_RUNS_RESOURCE_URI);

      await vi.waitFor(
        () =>
          expect(receivedA.some((n) => n.method === 'notifications/resources/updated')).toBe(true),
        { timeout: 4000 },
      );
      // Give any errant cross-user delivery a bounded window to arrive, then assert
      // B saw no resource update. Single instance + synchronous publish make this
      // deterministic.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(receivedB.some((n) => n.method === 'notifications/resources/updated')).toBe(false);
    } finally {
      if (subA) await subA.close();
      if (subB) await subB.close();
      await clientA.close();
      await clientB.close();
    }
  });
});

describe('MCP transport — legacy subscribe acknowledged, never pushed (behaviour 2)', () => {
  it('acknowledges resources/subscribe on the legacy era and sends no follow-up notification', async () => {
    const client = await connectClient('legacy', reviewsToken);
    const received: { method: string }[] = [];
    client.fallbackNotificationHandler = async (notification) => {
      received.push(notification as { method: string });
    };
    try {
      // The legacy era acknowledges the subscription per spec (an empty result)...
      const ack = await client.subscribeResource({ uri: REVIEW_RUNS_RESOURCE_URI });
      expect(ack).toEqual({});
      // ...but it is stateless: there is no long-lived session to push to, so a
      // resource change reaches nobody on this connection.
      fixture.publishUserResourceUpdate(String(applicationUser.id), REVIEW_RUNS_RESOURCE_URI);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(
        received.some((notification) => notification.method === 'notifications/resources/updated'),
      ).toBe(false);
    } finally {
      await client.close();
    }
  });
});

describe('MCP transport — the authentication order survives the hook chain (behaviour 4)', () => {
  // Each test sends a request that would fail a *later* check and asserts an
  // earlier boundary short-circuits, proving SvelteKit's handle chain inserted
  // nothing ahead of the engine's order (no hook answers OPTIONS, reads the body,
  // or reorders auth). The order inside the library is TRI-99's; this is the mount.

  it('answers OPTIONS with 204 before any authentication runs (step 3 before step 4+)', async () => {
    // No Authorization header at all: if a later auth step ran first this would be
    // 401, and if a SvelteKit hook answered OPTIONS it would not be the engine's 204.
    const response = await runWithDatabase(fixture.database.db as never, () =>
      fixture.handle(new Request(`${BASE}/mcp`, { method: 'OPTIONS', headers: { origin: BASE } })),
    );
    expect(response.status).toBe(204);
  });

  it('rejects a disallowed Origin before looking up the token (step 2 before step 7)', async () => {
    // A valid bearer token, but a cross-site Origin: the Origin gate must refuse it
    // before the token is ever looked up.
    const response = await mcpRequest(initializeMessage(LEGACY_ERA), {
      origin: 'https://attacker.example',
    });
    expect(response.status).toBe(403);
  });

  it('rejects a non-Bearer authorization scheme (step 5)', async () => {
    // No Origin (accepted, AC5) so the scheme check is the operative boundary; a
    // Basic credential is refused on scheme, never looked up.
    const response = await mcpRequest(initializeMessage(LEGACY_ERA), {
      token: null,
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(response.status).toBe(401);
  });

  it('rejects an over-length bearer token before any token lookup (step 6 before step 7)', async () => {
    // One character over the configured maximum: refused on length, never hashed
    // or looked up. Asserted against the imported limit, not a literal (the issue's
    // 512 is Protokit's number; Tribunal configures 4096).
    const overLong = 'a'.repeat(mcpRuntimeLimits.maximumBearerTokenLength + 1);
    const response = await mcpRequest(initializeMessage(LEGACY_ERA), { token: overLong });
    expect(response.status).toBe(401);
  });

  it('locks out an IP after repeated failures, before even a valid token is looked up (step 4 before step 7)', async () => {
    // A distinct client address so this cannot poison 127.0.0.1 for the rest of the
    // file (the lockout is keyed by network identity). Exhaust the failed-auth
    // budget with malformed-but-well-formed bearer tokens, then present a VALID
    // token from the same IP: the lockout (step 4) must refuse it with 429 before
    // the token is ever looked up (step 7).
    const lockoutAddress = '203.0.113.7';
    for (
      let attempt = 0;
      attempt < mcpRuntimeLimits.maximumFailedAuthenticationAttempts;
      attempt += 1
    ) {
      const failed = await mcpRequest(initializeMessage(LEGACY_ERA), {
        token: 'not-a-real-token',
        clientAddress: lockoutAddress,
      });
      expect(failed.status).toBe(401);
    }
    const lockedOut = await mcpRequest(initializeMessage(LEGACY_ERA), {
      token: accessToken,
      clientAddress: lockoutAddress,
    });
    expect(lockedOut.status).toBe(429);
  });

  it('rejects a token minted for a different resource, indistinguishably from an unknown token (step 8, OBS-001)', async () => {
    // Seed a token that is unrevoked, unexpired, correctly hashed, and owned by a
    // real user — but bound to a different resource. It passes scheme, length, and
    // the lookup, and is refused only at the audience check (step 8). Its rejection
    // must be byte-identical to an unknown token's (OBS-001 / RFC 6750): the
    // endpoint must not become an oracle for whether a given token exists.
    const wrongResourceToken = 'tri43-audience-mismatch-token-000000000000';
    await fixture.stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: hashWithSha256(wrongResourceToken),
        clientId: registeredClientId,
        userId: String(applicationUser.id),
        scope: 'reviews:read',
        resource: 'https://not-tribunal.example/mcp',
        expiresAt: new Date(Date.now() + 3_600_000),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    const audienceMismatch = await mcpRequest(initializeMessage(LEGACY_ERA), {
      token: wrongResourceToken,
    });
    const unknownToken = await mcpRequest(initializeMessage(LEGACY_ERA), {
      token: 'tri43-never-issued-token-11111111111111111',
    });

    expect(audienceMismatch.status).toBe(unknownToken.status);
    expect(audienceMismatch.status).toBe(401);
    expect(audienceMismatch.headers.get('www-authenticate')).toBe(
      unknownToken.headers.get('www-authenticate'),
    );
    expect(await audienceMismatch.text()).toBe(await unknownToken.text());
  });
});
