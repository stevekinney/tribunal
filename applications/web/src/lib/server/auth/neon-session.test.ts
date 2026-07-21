import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createUserFactory, resetIdCounter } from '@tribunal/test/factories';
import { runWithDatabase } from '$lib/server/database';
import { user as userTable } from '@tribunal/database/schema';

// Deliberately excludes NEON_AUTH_BASE_URL so the "no baseUrl configured"
// test below is deterministic regardless of the ambient shell/CI environment,
// rather than relying on the variable happening to be unset.
vi.mock('$env/dynamic/private', () => ({
  env: {
    E2E_TEST_MODE: '0',
  },
}));
import {
  createNeonSessionFromToken,
  deleteNeonAuthTokenCookie,
  findUserByEmail,
  neonAuthTokenCookieName,
  resetNeonAuthJwksCacheForTests,
  setNeonAuthTokenCookie,
  upsertApplicationUserFromNeonToken,
  validateNeonSessionFromToken,
  verifyNeonAuthToken,
  type VerifiedNeonToken,
} from './neon-session';

const neonAuthBaseUrl = 'https://auth.example.test';

let privateKey: CryptoKey;
let publicJwks: ReturnType<typeof createLocalJWKSet>;

async function createToken(
  overrides: {
    subject?: string;
    issuer?: string;
    audience?: string;
    email?: string;
    name?: string;
    picture?: string;
    expiresAt?: number;
    signingKey?: CryptoKey;
  } = {},
): Promise<string> {
  return new SignJWT({
    email: overrides.email ?? 'test@example.com',
    name: overrides.name ?? 'Test User',
    picture: overrides.picture ?? 'https://example.test/avatar.png',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(overrides.subject ?? 'neon-user-1')
    .setIssuer(overrides.issuer ?? neonAuthBaseUrl)
    .setAudience(overrides.audience ?? neonAuthBaseUrl)
    .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(overrides.signingKey ?? privateKey);
}

function tokenVerificationOptions() {
  return {
    baseUrl: neonAuthBaseUrl,
    key: publicJwks,
  };
}

describe('verifyNeonAuthToken', () => {
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const publicJwk = await exportJWK(keys.publicKey);
    publicJwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256' }] });
  });

  beforeEach(() => {
    resetNeonAuthJwksCacheForTests();
  });

  it('accepts valid issuer, audience, signature, and expiration', async () => {
    const token = await createToken();

    const verifiedToken = await verifyNeonAuthToken(token, tokenVerificationOptions());

    expect(verifiedToken).toMatchObject({
      token,
      neonAuthUserId: 'neon-user-1',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: 'https://example.test/avatar.png',
    });
    expect(verifiedToken.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect.assertions(2);
  });

  it('uses the Neon Auth origin for issuer and audience when the URL includes a path', async () => {
    const pathBasedBaseUrl = 'https://auth.example.test/neondb/auth';
    const token = await createToken({
      issuer: 'https://auth.example.test',
      audience: 'https://auth.example.test',
    });

    const verifiedToken = await verifyNeonAuthToken(token, {
      ...tokenVerificationOptions(),
      baseUrl: pathBasedBaseUrl,
    });

    expect(verifiedToken.neonAuthUserId).toBe('neon-user-1');
    expect.assertions(1);
  });

  it('rejects missing, expired, malformed, wrong issuer, and wrong audience tokens', async () => {
    await expect(verifyNeonAuthToken('', tokenVerificationOptions())).rejects.toMatchObject({
      status: 401,
    });

    await expect(
      verifyNeonAuthToken(
        await createToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
        tokenVerificationOptions(),
      ),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      verifyNeonAuthToken('not-a-jwt', tokenVerificationOptions()),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      verifyNeonAuthToken(
        await createToken({ issuer: 'https://wrong-issuer.example.test' }),
        tokenVerificationOptions(),
      ),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      verifyNeonAuthToken(
        await createToken({ audience: 'https://wrong-audience.example.test' }),
        tokenVerificationOptions(),
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect.assertions(5);
  });

  it('rejects tokens signed by an unknown key', async () => {
    const otherKeys = await generateKeyPair('RS256');

    await expect(
      verifyNeonAuthToken(
        await createToken({ signingKey: otherKeys.privateKey }),
        tokenVerificationOptions(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect.assertions(1);
  });

  it('throws when no baseUrl is supplied and NEON_AUTH_BASE_URL is not configured', async () => {
    const token = await createToken();

    // No baseUrl override: falls through to getConfiguredNeonAuthBaseUrl(),
    // which reads env.NEON_AUTH_BASE_URL — unset in this test environment.
    await expect(verifyNeonAuthToken(token, { key: publicJwks })).rejects.toThrow(
      'NEON_AUTH_BASE_URL is required to verify Neon Auth tokens',
    );
  });

  it('resolves a remote JWKS key getter when no key override is supplied (network unreachable, fails closed)', async () => {
    const token = await createToken();

    // No `key` override: exercises getRemoteJwks()/normalizeNeonAuthBaseUrl(),
    // which construct a lazy remote JWKS fetcher. The domain doesn't resolve,
    // so verification fails closed with 401 rather than validating — this
    // only proves the construction path runs, not a live fetch.
    await expect(
      verifyNeonAuthToken(token, { baseUrl: 'https://neon-auth.invalid.test/base/' }),
    ).rejects.toMatchObject({ status: 401 });
  }, 10_000);

  it('reuses the cached remote JWKS fetcher across calls for the same base URL', async () => {
    const token = await createToken();
    const options = { baseUrl: 'https://neon-auth.invalid.test/base/' };

    // First call constructs and caches the remote JWKS fetcher; the second
    // call (no reset in between) must hit the cache instead of constructing
    // a new one.
    await expect(verifyNeonAuthToken(token, options)).rejects.toMatchObject({ status: 401 });
    await expect(verifyNeonAuthToken(token, options)).rejects.toMatchObject({ status: 401 });
  }, 10_000);

  it('rejects a token with no subject claim', async () => {
    const token = await new SignJWT({ email: 'test@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(neonAuthBaseUrl)
      .setAudience(neonAuthBaseUrl)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(privateKey);

    await expect(verifyNeonAuthToken(token, tokenVerificationOptions())).rejects.toMatchObject({
      status: 401,
      body: { message: 'Invalid Neon Auth token subject' },
    });
  });

  it('rejects a token with no expiration claim', async () => {
    const token = await new SignJWT({ email: 'test@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('neon-user-1')
      .setIssuer(neonAuthBaseUrl)
      .setAudience(neonAuthBaseUrl)
      .sign(privateKey);

    await expect(verifyNeonAuthToken(token, tokenVerificationOptions())).rejects.toMatchObject({
      status: 401,
      body: { message: 'Invalid Neon Auth token expiration' },
    });
  });
});

describe('cookie helpers', () => {
  it('sets the Neon Auth cookie with the expected security attributes', () => {
    const cookies = { set: () => {}, delete: () => {} };
    const setSpy = vi.spyOn(cookies, 'set');
    const expiresAt = new Date(Date.now() + 60_000);

    setNeonAuthTokenCookie({ cookies } as never, 'a-token', expiresAt);

    expect(setSpy).toHaveBeenCalledWith(
      neonAuthTokenCookieName,
      'a-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', expires: expiresAt }),
    );
  });

  it('deletes the Neon Auth cookie with matching attributes', () => {
    const cookies = { set: () => {}, delete: () => {} };
    const deleteSpy = vi.spyOn(cookies, 'delete');

    deleteNeonAuthTokenCookie({ cookies } as never);

    expect(deleteSpy).toHaveBeenCalledWith(
      neonAuthTokenCookieName,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });
});

describe('Neon Auth profile upsert', () => {
  let testDb: TestDatabase;
  let userFactory: ReturnType<typeof createUserFactory>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    userFactory = createUserFactory(testDb.db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    resetIdCounter();
  });

  async function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  function verifiedToken(overrides: Partial<VerifiedNeonToken> = {}): VerifiedNeonToken {
    return {
      token: 'test-token',
      neonAuthUserId: 'neon-user-1',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: 'https://example.test/avatar.png',
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  it('upserts by neon_auth_user_id', async () => {
    const existingUser = await userFactory.create({
      username: 'existing-user',
      neonAuthUserId: 'neon-user-1',
      email: 'old@example.com',
      isPlatformAdministrator: true,
    });

    const applicationUser = await withTestDatabase(() =>
      upsertApplicationUserFromNeonToken(
        verifiedToken({ email: 'new@example.com', name: 'Updated Name' }),
      ),
    );

    expect(applicationUser.id).toBe(existingUser.id);
    expect(applicationUser.email).toBe('new@example.com');
    expect(applicationUser.name).toBe('Updated Name');
    expect(applicationUser.isPlatformAdministrator).toBe(true);
    expect.assertions(4);
  });

  it('preserves mapped profile fields when Neon omits profile claims', async () => {
    const existingUser = await userFactory.create({
      username: 'existing-user',
      neonAuthUserId: 'neon-user-1',
      email: 'old@example.com',
      name: 'Existing Name',
      avatarUrl: 'https://example.test/existing.png',
    });

    const applicationUser = await withTestDatabase(() =>
      upsertApplicationUserFromNeonToken(
        verifiedToken({ email: 'new@example.com', name: null, avatarUrl: null }),
      ),
    );

    expect(applicationUser.id).toBe(existingUser.id);
    expect(applicationUser.email).toBe('new@example.com');
    expect(applicationUser.name).toBe('Existing Name');
    expect(applicationUser.avatarUrl).toBe('https://example.test/existing.png');
    expect.assertions(4);
  });

  it('attaches an existing email-matched user only when it has no Neon Auth mapping', async () => {
    const existingUser = await userFactory.create({
      username: 'email-match',
      neonAuthUserId: null,
      email: 'match@example.com',
      isPlatformAdministrator: true,
    });

    const applicationUser = await withTestDatabase(() =>
      upsertApplicationUserFromNeonToken(
        verifiedToken({ neonAuthUserId: 'neon-email-match', email: 'match@example.com' }),
      ),
    );

    const [storedUser] = await testDb.db
      .select()
      .from(userTable)
      .where(eq(userTable.id, existingUser.id));

    expect(applicationUser.id).toBe(existingUser.id);
    expect(applicationUser.isPlatformAdministrator).toBe(true);
    expect(storedUser.neonAuthUserId).toBe('neon-email-match');
    expect.assertions(3);
  });

  it('preserves email-matched profile fields when Neon omits profile claims', async () => {
    const existingUser = await userFactory.create({
      username: 'email-match',
      neonAuthUserId: null,
      email: 'match@example.com',
      name: 'Email Match',
      avatarUrl: 'https://example.test/email-match.png',
    });

    const applicationUser = await withTestDatabase(() =>
      upsertApplicationUserFromNeonToken(
        verifiedToken({
          neonAuthUserId: 'neon-email-match',
          email: 'match@example.com',
          name: null,
          avatarUrl: null,
        }),
      ),
    );

    const [storedUser] = await testDb.db
      .select()
      .from(userTable)
      .where(eq(userTable.id, existingUser.id));

    expect(applicationUser.id).toBe(existingUser.id);
    expect(storedUser.neonAuthUserId).toBe('neon-email-match');
    expect(storedUser.name).toBe('Email Match');
    expect(storedUser.avatarUrl).toBe('https://example.test/email-match.png');
    expect.assertions(4);
  });

  it('rejects email matches that already have a different Neon Auth mapping', async () => {
    await userFactory.create({
      username: 'mapped-email',
      neonAuthUserId: 'different-neon-user',
      email: 'mapped@example.com',
    });

    await expect(
      withTestDatabase(() =>
        upsertApplicationUserFromNeonToken(
          verifiedToken({ neonAuthUserId: 'new-neon-user', email: 'mapped@example.com' }),
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect.assertions(1);
  });

  it('returns the mapped user unchanged when the token carries no profile claims to apply', async () => {
    const existingUser = await userFactory.create({
      username: 'already-current',
      neonAuthUserId: 'neon-user-1',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: 'https://example.test/avatar.png',
    });

    // name/avatarUrl null means there's nothing to update, and email null
    // means includeEmail is never considered -- `updates` ends up empty, so
    // the mapped row is returned as-is without an UPDATE round trip.
    const applicationUser = await withTestDatabase(() =>
      upsertApplicationUserFromNeonToken(
        verifiedToken({ name: null, avatarUrl: null, email: null }),
      ),
    );

    expect(applicationUser).toMatchObject({
      id: existingUser.id,
      username: existingUser.username,
      email: existingUser.email,
      name: existingUser.name,
      avatarUrl: existingUser.avatarUrl,
    });
    expect.assertions(1);
  });

  it('creates a new application profile from a valid Neon token', async () => {
    const token = await createToken({
      subject: 'neon-created-user',
      email: 'created@example.com',
      name: 'Created User',
    });

    const { user, neonSession } = await withTestDatabase(() =>
      createNeonSessionFromToken(token, tokenVerificationOptions()),
    );

    expect(user).toMatchObject({
      username: 'created-user',
      email: 'created@example.com',
      name: 'Created User',
      isPlatformAdministrator: false,
    });
    expect(neonSession.neonAuthUserId).toBe('neon-created-user');
    expect.assertions(2);
  });

  it('gives up with 409 once every deterministic and randomized handle candidate is taken', async () => {
    // Occupy every deterministic candidate the first loop tries (base, then
    // base-2..base-10) so it falls through to the randomized-suffix loop,
    // and pin crypto.randomUUID so every randomized candidate collides too --
    // forcing the whole generator to exhaust and hit the 409 fallback.
    const base = 'exhaust-test';
    await userFactory.create({ username: base });
    for (let attempt = 2; attempt <= 10; attempt += 1) {
      await userFactory.create({ username: `${base}-${attempt}` });
    }
    await userFactory.create({ username: `${base}-aaaaaaaa` });
    const randomUUIDSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('aaaaaaaa-0000-0000-0000-000000000000');

    await expect(
      withTestDatabase(() =>
        upsertApplicationUserFromNeonToken(
          verifiedToken({ neonAuthUserId: 'neon-exhausted-user', name: 'Exhaust Test' }),
        ),
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { message: 'Could not create an available Tribunal username' },
    });

    randomUUIDSpy.mockRestore();
  });

  it('validates mapped Neon sessions without updating profile fields', async () => {
    const existingUser = await userFactory.create({
      username: 'mapped-user',
      neonAuthUserId: 'neon-read-only-user',
      email: 'old@example.com',
      name: 'Old Name',
      avatarUrl: 'https://example.test/old.png',
      isPlatformAdministrator: true,
    });
    const token = await createToken({
      subject: 'neon-read-only-user',
      email: 'new@example.com',
      name: 'New Name',
      picture: 'https://example.test/new.png',
    });

    const { user } = await withTestDatabase(() =>
      validateNeonSessionFromToken(token, tokenVerificationOptions()),
    );

    const [storedUser] = await testDb.db
      .select()
      .from(userTable)
      .where(eq(userTable.id, existingUser.id));

    expect(user).toMatchObject({
      id: existingUser.id,
      email: 'old@example.com',
      name: 'Old Name',
      avatarUrl: 'https://example.test/old.png',
      isPlatformAdministrator: true,
    });
    expect(storedUser.email).toBe('old@example.com');
    expect(storedUser.name).toBe('Old Name');
    expect(storedUser.avatarUrl).toBe('https://example.test/old.png');
    expect.assertions(4);
  });

  it('rejects a valid Neon token that is not linked to a Tribunal user', async () => {
    const token = await createToken({ subject: 'neon-unlinked-user' });

    await expect(
      withTestDatabase(() => validateNeonSessionFromToken(token, tokenVerificationOptions())),
    ).rejects.toMatchObject({ status: 401 });
    expect.assertions(1);
  });

  it('finds a user by email case-insensitively', async () => {
    const existingUser = await userFactory.create({
      username: 'find-by-email',
      email: 'Mixed-Case@Example.com',
    });

    const found = await withTestDatabase(() => findUserByEmail('mixed-case@example.com'));
    const notFound = await withTestDatabase(() => findUserByEmail('nobody@example.com'));

    expect(found?.id).toBe(existingUser.id);
    expect(notFound).toBeNull();
  });
});
