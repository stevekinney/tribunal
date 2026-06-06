import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createUserFactory, resetIdCounter } from '@tribunal/test/factories';
import { runWithDatabase } from '$lib/server/database';
import { user as userTable } from '@tribunal/database/schema';
import {
  createNeonSessionFromToken,
  resetNeonAuthJwksCacheForTests,
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
});
