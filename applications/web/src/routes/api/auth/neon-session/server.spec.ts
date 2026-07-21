import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createUserFactory, resetIdCounter } from '@tribunal/test/factories';
import { user as userTable } from '@tribunal/database/schema';
import { runWithDatabase } from '$lib/server/database';
import {
  neonAuthTokenCookieName,
  resetNeonAuthJwksCacheForTests,
} from '$lib/server/auth/neon-session';
import { createMockRequestEvent } from '$lib/test-utils/request-event';

const environment = vi.hoisted(() => ({
  baseUrl: 'http://127.0.0.1:0',
}));

vi.mock('$env/dynamic/private', () => ({
  env: {
    get NEON_AUTH_BASE_URL() {
      return environment.baseUrl;
    },
    E2E_TEST_MODE: '1',
  },
}));

let privateKey: CryptoKey;
let publicJwk: JWK;
let jwksServer: Server;
let testDb: TestDatabase;
let userFactory: ReturnType<typeof createUserFactory>;

async function createToken(overrides: { subject?: string; email?: string; name?: string } = {}) {
  const issuerAndAudience = new URL(environment.baseUrl).origin;

  return new SignJWT({
    email: overrides.email ?? 'bridge@example.com',
    name: overrides.name ?? 'Bridge User',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'bridge-key' })
    .setSubject(overrides.subject ?? 'neon-bridge-user')
    .setIssuer(issuerAndAudience)
    .setAudience(issuerAndAudience)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        resolve(address.port);
      }
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('POST /api/auth/neon-session', () => {
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'bridge-key', alg: 'RS256' };

    jwksServer = createServer((request, response) => {
      if (request.url === '/neondb/auth/.well-known/jwks.json') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    const port = await listen(jwksServer);
    environment.baseUrl = `http://127.0.0.1:${port}/neondb/auth`;

    testDb = await createTestDatabase();
    userFactory = createUserFactory(testDb.db);
  });

  afterAll(async () => {
    await testDb.close();
    await close(jwksServer);
  });

  beforeEach(async () => {
    await testDb.reset();
    resetIdCounter();
    resetNeonAuthJwksCacheForTests();
  });

  async function postToken(token: string) {
    const event = createMockRequestEvent({
      url: 'http://localhost/api/auth/neon-session',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    event.request = new Request('http://localhost/api/auth/neon-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    event.cookies.set = vi.fn();

    const { POST } = await import('./+server');
    const response = await runWithDatabase(testDb.db as never, () =>
      POST(event as Parameters<typeof POST>[0]),
    );
    return { event, response };
  }

  it('sets an HTTP-only bridge cookie for valid tokens', async () => {
    const token = await createToken();

    const { event, response } = await postToken(token);

    expect(response.status).toBe(200);
    expect(event.cookies.set).toHaveBeenCalledWith(
      neonAuthTokenCookieName,
      token,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
    expect.assertions(2);
  });

  it('rejects a malformed JSON body', async () => {
    const event = createMockRequestEvent({
      url: 'http://localhost/api/auth/neon-session',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    event.request = new Request('http://localhost/api/auth/neon-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    const { POST } = await import('./+server');

    await expect(
      runWithDatabase(testDb.db as never, () => POST(event as Parameters<typeof POST>[0])),
    ).rejects.toMatchObject({ status: 400, body: { message: 'Expected JSON request body' } });
  });

  it('rejects a request body missing a token', async () => {
    const event = createMockRequestEvent({
      url: 'http://localhost/api/auth/neon-session',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    event.request = new Request('http://localhost/api/auth/neon-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const { POST } = await import('./+server');

    await expect(
      runWithDatabase(testDb.db as never, () => POST(event as Parameters<typeof POST>[0])),
    ).rejects.toMatchObject({ status: 400, body: { message: 'Missing Neon Auth token' } });
  });

  it('rejects a request body with an empty token', async () => {
    const event = createMockRequestEvent({
      url: 'http://localhost/api/auth/neon-session',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    event.request = new Request('http://localhost/api/auth/neon-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    });

    const { POST } = await import('./+server');

    await expect(
      runWithDatabase(testDb.db as never, () => POST(event as Parameters<typeof POST>[0])),
    ).rejects.toMatchObject({ status: 400, body: { message: 'Missing Neon Auth token' } });
  });

  it('preserves the SvelteKit HttpError status and message for invalid tokens', async () => {
    const { response } = await postToken('not-a-jwt');
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(401);
    expect(body.error.message).toBe('Invalid Neon Auth token');
    expect.assertions(2);
  });

  it('upserts by neon_auth_user_id and preserves platform administrator status', async () => {
    const existingUser = await userFactory.create({
      username: 'bridge-admin',
      neonAuthUserId: 'neon-bridge-user',
      email: 'old-bridge@example.com',
      isPlatformAdministrator: true,
    });

    const { response } = await postToken(
      await createToken({ email: 'updated-bridge@example.com' }),
    );
    const body = (await response.json()) as {
      user: { id: number; isPlatformAdministrator: boolean };
    };

    expect(body.user.id).toBe(existingUser.id);
    expect(body.user.isPlatformAdministrator).toBe(true);
    expect.assertions(2);
  });

  it('attaches an existing email-matched user only when that user has no Neon Auth mapping', async () => {
    const existingUser = await userFactory.create({
      username: 'bridge-email',
      neonAuthUserId: null,
      email: 'bridge-email@example.com',
    });

    await postToken(
      await createToken({
        subject: 'neon-email-bridge',
        email: 'bridge-email@example.com',
      }),
    );

    const [storedUser] = await testDb.db
      .select()
      .from(userTable)
      .where(eq(userTable.id, existingUser.id));

    expect(storedUser.neonAuthUserId).toBe('neon-email-bridge');
    expect.assertions(1);
  });

  it('masks unexpected session bridge failures', async () => {
    expect.assertions(4);
    vi.resetModules();
    const createNeonSessionFromToken = vi
      .fn()
      .mockRejectedValue(new Error('Failed query: select secret from user'));

    vi.doMock('$lib/server/auth/neon-session', () => ({
      createNeonSessionFromToken,
      setNeonAuthTokenCookie: vi.fn(),
    }));

    const event = createMockRequestEvent({
      url: 'http://localhost/api/auth/neon-session',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    event.request = new Request('http://localhost/api/auth/neon-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'valid-looking-token' }),
    });

    try {
      const { POST } = await import('./+server');
      const response = await POST(event as Parameters<typeof POST>[0]);
      const body = (await response.json()) as { error: { message: string } };

      expect(response.status).toBe(500);
      expect(createNeonSessionFromToken).toHaveBeenCalledWith('valid-looking-token');
      expect(body.error.message).toBe('Tribunal could not create a local session');
      expect(body.error.message).not.toContain('select secret');
    } finally {
      vi.doUnmock('$lib/server/auth/neon-session');
      vi.resetModules();
    }
  });
});
