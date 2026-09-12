import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpContext } from '@lostgradient/mcp';
import { user } from '@tribunal/database/schema';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { mintAccessToken, registerOAuthClient } from '$testing/mcp/oauth-token-minting';
import { runWithDatabase } from '$lib/server/database';
import { mcpBaseUrl } from '$lib/server/oauth/configuration';
import { REVIEW_RUNS_RESOURCE_URI } from './resource-updates';
import { listRepositoriesTool } from './tools/repository-tools';
import * as repositoryReader from './readers/repository-reader';
import * as userIdentity from './user-identity';

// SvelteKit captures private environment separately from process.env, so set
// this at its boundary before the real mount imports it. Rate-limit state must
// also be fixture-local, never the Redis instance in a developer's .env file.
vi.mock('$env/dynamic/private', async (importOriginal) => {
  const original = await importOriginal<typeof import('$env/dynamic/private')>();
  return { env: { ...original.env, DEV_AUTH_BYPASS: '0', REDIS_URL: '' } };
});

let fixture: McpMountFixture;
let repositoriesToken: string;
let reviewsToken: string;
let userId: string;

beforeAll(async () => {
  // A developer shell can arm the UI bypass. This fixture supplies a genuine
  // authenticated user and must exercise the ordinary OAuth identity path.
  fixture = await setupMcpMountFixture();
  const [applicationUser] = await fixture.database.db
    .insert(user)
    .values({ username: 'passthrough-user', email: 'passthrough@example.com' })
    .returning();
  if (!applicationUser) throw new Error('Expected the test user to be inserted.');
  userId = String(applicationUser.id);
  const clientId = await registerOAuthClient(fixture);
  repositoriesToken = await mintAccessToken(
    fixture,
    'repositories:read',
    applicationUser,
    clientId,
  );
  reviewsToken = await mintAccessToken(fixture, 'reviews:read', applicationUser, clientId);
});

afterAll(async () => {
  try {
    await fixture?.dispose();
  } finally {
    vi.restoreAllMocks();
  }
});

/** Inspect values as well as keys: an opaque token in an innocently named field is still a leak. */
function assertNoCredentials(value: unknown, visited = new Set<object>()): void {
  if (typeof value === 'string') {
    expect(value.includes(repositoriesToken) || value.includes(reviewsToken)).toBe(false);
    expect(/\bBearer\s|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(value)).toBe(false);
  }
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  // These are the two intentional capabilities, not bags of caller metadata.
  if (value instanceof AbortSignal) return;
  visited.add(value);
  for (const key of Reflect.ownKeys(value)) {
    expect(String(key)).not.toMatch(/token|authorization|cookie|secret|credential/i);
    assertNoCredentials(Reflect.get(value, key), visited);
  }
}

function listen(token: string): Promise<Response> {
  return runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(
      new Request(`${mcpBaseUrl.origin}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 54,
          method: 'subscriptions/listen',
          params: { notifications: { resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI] } },
        }),
      }),
    ),
  );
}

type ListenResponse = { status: number; challenge: string | null };

async function connectModernClient(
  token: string,
  listenResponses: ListenResponse[] = [],
): Promise<Client> {
  const client = new Client(
    { name: 'tri-54-guards', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${mcpBaseUrl.origin}/mcp`), {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          request.headers.set('authorization', `Bearer ${token}`);
          const message =
            request.method === 'POST'
              ? ((await request.clone().json()) as { method?: string })
              : undefined;
          const response = await runWithDatabase(fixture.database.db as never, () =>
            fixture.handle(request),
          );
          if (message?.method === 'subscriptions/listen') {
            listenResponses.push({
              status: response.status,
              challenge: response.headers.get('www-authenticate'),
            });
          }
          return response;
        },
      }),
    );
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

describe('MCP credential and subscription guards through the mounted surface (TRI-54)', () => {
  it('exposes no token-shaped field in the context the real handler receives', async () => {
    // defineRegistry normalizes tool definitions. Observe the context inside
    // the real handler at its identity boundary rather than spying on its copy.
    const identity = vi.spyOn(userIdentity, 'resolveTribunalUserId');
    const reader = vi
      .spyOn(repositoryReader, 'listAccessibleRepositories')
      .mockResolvedValue({ ok: true, repositories: [] });
    let client: Client | undefined;
    try {
      client = await connectModernClient(repositoriesToken);
      const result = await client.callTool({ name: listRepositoriesTool.name, arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(identity).toHaveBeenCalledOnce();
      expect(reader).toHaveBeenCalledWith(Number(userId));
      const context = identity.mock.calls[0]![0] as McpContext;
      // The library's runtime context includes server metadata beyond McpContext's
      // declared fields. Pin that actual surface, rather than inspecting a type.
      const allowedKeys = new Set([
        'userId',
        'user',
        'requestId',
        'signal',
        'publishResourceUpdate',
        'scopes',
        'era',
        'enableUiExtension',
        'enableConformanceMode',
      ]);
      expect(Reflect.ownKeys(context).filter((key) => !allowedKeys.has(String(key)))).toEqual([]);
      expect(context.userId).toBe(userId);
      expect(context.signal).toBeInstanceOf(AbortSignal);
      expect(Reflect.ownKeys(context.user).sort()).toEqual([
        'email',
        'id',
        'image',
        'name',
        'role',
      ]);
      assertNoCredentials(context);
    } finally {
      await client?.close();
      identity.mockRestore();
      reader.mockRestore();
    }
  });

  it('refuses subscriptions/listen for an authenticated token without reviews:read', async () => {
    const response = await listen(repositoriesToken);
    try {
      expect(response.status).toBe(403);
      expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
      expect(await response.json()).toMatchObject({ error: 'forbidden' });
    } finally {
      // A regressed guard opens an endless SSE stream. Cancel even when the
      // status assertion fails so the negative control cannot hang the suite.
      if (!response.bodyUsed) await response.body?.cancel();
    }
  });

  it('accepts the same subscription request with reviews:read', async () => {
    const response = await listen(reviewsToken);
    try {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    } finally {
      await response.body?.cancel();
    }
  });

  it('refuses modern Client.listen with the SDK envelope when reviews:read is absent', async () => {
    const responses: ListenResponse[] = [];
    const client = await connectModernClient(repositoriesToken, responses);
    let subscription: Awaited<ReturnType<Client['listen']>> | undefined;
    try {
      expect(client.getProtocolEra()).toBe('modern');
      const listening = client
        .listen({ resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI] } as never)
        .then((opened) => {
          subscription = opened;
          return opened;
        });
      await expect(listening).rejects.toThrow();
      expect(responses).toEqual([
        {
          status: 403,
          challenge: expect.stringContaining('error="insufficient_scope"'),
        },
      ]);
    } finally {
      // If enforcement regresses, listen succeeds. Close that stream even when
      // the rejection assertion fails; a negative control must not hang.
      await subscription?.close();
      await client.close();
    }
  });

  it('accepts modern Client.listen with the same SDK envelope and reviews:read', async () => {
    const responses: ListenResponse[] = [];
    const client = await connectModernClient(reviewsToken, responses);
    let subscription: Awaited<ReturnType<Client['listen']>> | undefined;
    try {
      expect(client.getProtocolEra()).toBe('modern');
      subscription = await client.listen({
        resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI],
      } as never);
      expect(responses).toEqual([{ status: 200, challenge: null }]);
      expect(subscription.honoredFilter).toMatchObject({
        resourceSubscriptions: [REVIEW_RUNS_RESOURCE_URI],
      });
    } finally {
      await subscription?.close();
      await client.close();
    }
  });
});
