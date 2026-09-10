import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
 * Streaming rule: a `subscriptions/listen` response never ends. The modern
 * delivery and isolation tests open it through the SDK client's `listen()` and
 * tear it down with `subscription.close()` / `client.close()` rather than reading
 * the body directly; the idle-timeout test drains the raw stream on a background
 * reader and cancels it. No test `await`s a listen response body to completion.
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
  expect(registration.status).toBe(201);
  const clientId = ((await registration.json()) as { client_id?: string }).client_id;
  expect(clientId).toBeTruthy();
  return clientId!;
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

  it('rejects a DNS-rebinding request before Origin or token processing (step 1)', async () => {
    // Target an explicit loopback host so the check fires regardless of how
    // MCP_BASE_URL is configured — a non-loopback base would otherwise route this
    // to the Origin allowlist (step 2) instead of the rebinding guard (step 1). A
    // non-localhost Origin is the rebinding signature; with an invalid token too,
    // step 1 refuses it 403 with its own message, ahead of Origin (step 2, a
    // different 403) and the token lookup (401). The message distinguishes step 1.
    const response = await runWithDatabase(fixture.database.db as never, () =>
      fixture.handle(
        new Request('http://127.0.0.1/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: 'Bearer not-a-real-token',
            origin: 'https://attacker.example',
          },
          body: JSON.stringify(initializeMessage(LEGACY_ERA)),
        }),
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('rebinding');
  });

  it('rejects a disallowed Origin before looking up the token (step 2 before step 7)', async () => {
    // A localhost Origin on the wrong port passes rebinding (step 1, both host and
    // origin are localhost) but fails the Origin allowlist (step 2). With an invalid
    // token: Origin-first is 403; a regressed lookup-first would surface 401. The
    // message confirms it is the Origin rejection, not rebinding.
    const response = await mcpRequest(initializeMessage(LEGACY_ERA), {
      token: 'not-a-real-token',
      origin: 'http://localhost:1',
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Origin is not allowed');
  });

  it('rejects a non-Bearer scheme before looking up the credential (step 5 before step 7)', async () => {
    // The credential IS a valid bearer token, but presented under the Basic
    // scheme. Scheme-first rejects it 401; a regression that ignored the scheme
    // and looked the credential up would succeed (200). Asserting 401 distinguishes
    // the two.
    const response = await mcpRequest(initializeMessage(LEGACY_ERA), {
      token: null,
      headers: { authorization: `Basic ${accessToken}` },
    });
    expect(response.status).toBe(401);
  });

  it('rejects an over-length bearer token before any token lookup (step 6 before step 7)', async () => {
    // Seed a genuinely valid grant whose token is one character over the maximum,
    // for THIS resource, so a regression that hashed and looked it up before the
    // length check would return 200. The length gate must refuse it 401 first.
    // Asserted against the imported limit, not a literal (the issue's 512 is
    // Protokit's number; Tribunal configures 4096).
    const overLong = 'a'.repeat(mcpRuntimeLimits.maximumBearerTokenLength + 1);
    await fixture.stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: hashWithSha256(overLong),
        clientId: registeredClientId,
        userId: String(applicationUser.id),
        scope: 'reviews:read',
        resource: RESOURCE,
        expiresAt: new Date(Date.now() + 3_600_000),
        revokedAt: null,
        createdAt: new Date(),
      },
    });
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
    // Spy the token lookup: once locked out, a valid token must be refused 429
    // WITHOUT the store being queried. A regression that looked the token up before
    // (or instead of) the lockout check would call findByHash and still 429, which
    // a status-only assertion could not catch.
    const findByHash = vi.spyOn(fixture.stores.tokens, 'findByHash');
    try {
      const lockedOut = await mcpRequest(initializeMessage(LEGACY_ERA), {
        token: accessToken,
        clientAddress: lockoutAddress,
      });
      expect(lockedOut.status).toBe(429);
      expect(findByHash).not.toHaveBeenCalled();
    } finally {
      findByHash.mockRestore();
    }
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
    expect(audienceMismatch.headers.get('content-type')).toBe(
      unknownToken.headers.get('content-type'),
    );
    // Compare the full normalized header set — names AND values — so any future
    // divergence (a differing Cache-Control, rate-limit, or new auth header) that
    // would let a client tell the two apart fails here. Only Date is excluded, as
    // the two responses are produced a moment apart.
    const headerEntries = (response: Response) =>
      [...response.headers.entries()].filter(([name]) => name !== 'date').sort();
    expect(headerEntries(audienceMismatch)).toEqual(headerEntries(unknownToken));
    expect(await audienceMismatch.text()).toBe(await unknownToken.text());
  });
});

describe('MCP transport — idle streams survive under adapter-node/Node (behaviour 7)', () => {
  // Protokit set Bun.serve's idleTimeout to 60s because Bun's 10s default closed
  // long-lived listen streams before the SDK's 15s keep-alive could prevent it.
  // Tribunal runs under adapter-node (5.5.7), which calls http.createServer() and
  // sets none of server.timeout / requestTimeout / headersTimeout /
  // keepAliveTimeout; Node's server.timeout defaults to 0 (no socket-inactivity
  // close). So no override is needed here — measured, not assumed.
  //
  // This is a property of the RUNTIME's HTTP server, not of the mount's request
  // handling: the mount's own modern subscriptions/listen stream is proven
  // long-lived and delivering notifications through the mount in behaviour 3. Here
  // we isolate the runtime by standing up a Node server constructed exactly as
  // adapter-node constructs its own (http.createServer(), no timeout overrides),
  // serving a keep-alive-only SSE stream, and holding it idle past the 10s point
  // where Bun's default would have closed it. Fly's edge idle behaviour with
  // auto_stop_machines is the real-world closer of idle streams and is out of scope.
  it('does not close an idle SSE response stream past 10s (Node imposes no idle timeout)', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      });
      response.write(': connected\n\n');
      // Deliberately silent thereafter: the socket must be GENUINELY idle for the
      // whole hold. A keep-alive frame would reset any inactivity timer and mask a
      // regression that set server.timeout below the threshold.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    let tearingDown = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      await reader.read(); // the connected frame arrives promptly

      // Drain in the background. Until teardown begins, BOTH a clean end and a
      // premature read error mean the server closed the idle stream — a killed SSE
      // response commonly rejects the pending read rather than ending it, so the
      // catch must count as closure, not be swallowed.
      let closed = false;
      void (async () => {
        try {
          for (;;) {
            const { done } = await reader.read();
            if (done) {
              if (!tearingDown) closed = true;
              break;
            }
          }
        } catch {
          if (!tearingDown) closed = true;
        }
      })();

      // Hold idle past Bun's 10s default. Under Node's defaults the stream must
      // still be open.
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      expect(closed).toBe(false);
      tearingDown = true;
      await reader.cancel().catch(() => {});
    } finally {
      tearingDown = true;
      controller.abort();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});
