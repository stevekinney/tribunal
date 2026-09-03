import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createPostgresOAuthStores, type OAuthStores } from '@lostgradient/mcp/oauth/postgres';
import { eq } from '../operators';
import { user } from './user';
import {
  oauthAccessTokens,
  oauthAuthorizationTransactions,
  oauthClients,
  oauthCodes,
  oauthEngineSchema,
  oauthRefreshTokens,
  oauthAccessTokenRowSchema,
  oauthAuthorizationTransactionRowSchema,
  oauthClientRowSchema,
  oauthCodeRowSchema,
  oauthRefreshTokenRowSchema,
} from './oauth';

/**
 * These tests drive the published engine's own Postgres stores against
 * Tribunal's instantiation of the factory. That is deliberate: the value at
 * risk is not the SQL the library emits (its own suite covers that) but the
 * one thing this repository supplies — an `integer` user identifier where the
 * library's store interface types `userId` as an opaque `string`. Exercising
 * the real stores is what proves that seam holds end to end: that a string
 * subject round-trips through an `integer` foreign key, that the store's
 * hashing persists no plaintext, that both cascade directions fire, and that
 * refresh-family lineage survives rotation and replay.
 */

let testDatabase: TestDatabase;
let stores: OAuthStores;

const CLIENT_ID = 'client-under-test';
const RESOURCE = 'https://tribunal.example/mcp';

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
  // `testDatabase.db` satisfies the library's `PostgresOAuthDatabase`: it
  // exposes `execute(SQL)` and `transaction(cb)`, which is the whole executor
  // surface the stores depend on.
  stores = createPostgresOAuthStores(testDatabase.db, oauthEngineSchema);
});

async function createUser(username: string): Promise<number> {
  const [row] = await testDatabase.db.insert(user).values({ username }).returning({ id: user.id });
  return row!.id;
}

async function registerClient(): Promise<void> {
  await stores.clients.register({
    clientId: CLIENT_ID,
    clientSecretHash: 'stored-secret-hash',
    clientName: 'Client Under Test',
    clientType: 'confidential',
    tokenEndpointAuthMethod: 'client_secret_basic',
    applicationType: 'web',
    redirectUris: ['https://tribunal.example/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    clientIdMetadataUrl: null,
    clientSecretExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function hourFromNow(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

describe('oauth engine schema', () => {
  it('registers a client and round-trips its string-array jsonb columns', async () => {
    await registerClient();

    const [row] = await testDatabase.db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, CLIENT_ID));

    // Parsing through the hand-written row schema validates the `jsonb`
    // columns arrive as real `string[]`, matching `$type<string[]>()`.
    const parsed = oauthClientRowSchema.parse(row);
    expect(parsed.redirectUris).toEqual(['https://tribunal.example/callback']);
    expect(parsed.grantTypes).toContain('refresh_token');
    expect(parsed.responseTypes).toEqual(['code']);
  });

  it('persists a string subject through the integer user_id foreign key', async () => {
    const userId = await createUser('oauth-integer-fk');
    await registerClient();

    await stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: 'access-hash-1',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    const [row] = await testDatabase.db
      .select()
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.accessTokenHash, 'access-hash-1'));

    const parsed = oauthAccessTokenRowSchema.parse(row);
    // The column is `integer`, so the string subject the library handed the
    // store comes back as a JavaScript number equal to the user's id.
    expect(typeof parsed.userId).toBe('number');
    expect(parsed.userId).toBe(userId);
  });

  it('issues and consumes an authorization code once through the integer subject', async () => {
    const userId = await createUser('oauth-code-lifecycle');
    await registerClient();

    const codeHash = 'code-hash-1';
    await stores.codes.issue({
      codeHash,
      clientId: CLIENT_ID,
      userId: String(userId),
      redirectUri: 'https://tribunal.example/callback',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      scope: 'repositories:read',
      state: null,
      resource: RESOURCE,
      expiresAt: hourFromNow(),
      usedAt: null,
      createdAt: new Date(),
    });

    const [row] = await testDatabase.db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, codeHash));
    const parsed = oauthCodeRowSchema.parse(row);
    // The last integer foreign key: the code's subject round-trips too.
    expect(typeof parsed.userId).toBe('number');
    expect(parsed.userId).toBe(userId);

    // One-time semantics: the first consume spends the code, the second finds
    // nothing left to spend.
    const first = await stores.codes.consume(codeHash, new Date());
    expect(first).not.toBeNull();
    const second = await stores.codes.consume(codeHash, new Date());
    expect(second).toBeNull();
  });

  it('hashes the transaction and CSRF secrets rather than persisting plaintext', async () => {
    const userId = await createUser('oauth-hashing');
    await registerClient();

    const transactionId = 'plaintext-transaction-id';
    const csrfToken = 'plaintext-csrf-token';
    const consentBinding = 'plaintext-consent-binding';

    await stores.transactions.create({
      transactionId,
      csrfToken,
      consentBinding,
      record: {
        userId: String(userId),
        clientId: CLIENT_ID,
        redirectUri: 'https://tribunal.example/callback',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: null,
        issuer: 'https://tribunal.example',
        resource: RESOURCE,
        scope: 'repositories:read',
        expiresAt: hourFromNow(),
        consumedAt: null,
        createdAt: new Date(),
      },
    });

    const [row] = await testDatabase.db.select().from(oauthAuthorizationTransactions);
    const parsed = oauthAuthorizationTransactionRowSchema.parse(row);

    // The store persists hashes; the plaintext secrets never reach a column.
    expect(parsed.transactionIdHash).not.toBe(transactionId);
    expect(parsed.csrfTokenHash).not.toBe(csrfToken);
    expect(parsed.consentBindingHash).not.toBe(consentBinding);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(transactionId);
    expect(serialized).not.toContain(csrfToken);
    expect(serialized).not.toContain(consentBinding);
    expect(parsed.userId).toBe(userId);
  });

  it('cascades OAuth rows when the owning user is deleted', async () => {
    const userId = await createUser('oauth-user-cascade');
    await registerClient();

    await stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: 'access-hash-2',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
      refreshToken: {
        refreshTokenHash: 'refresh-hash-2',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        accessTokenHash: 'access-hash-2',
        familyId: 'family-2',
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    await testDatabase.db.delete(user).where(eq(user.id, userId));

    const accessRows = await testDatabase.db.select().from(oauthAccessTokens);
    const refreshRows = await testDatabase.db.select().from(oauthRefreshTokens);
    expect(accessRows).toHaveLength(0);
    expect(refreshRows).toHaveLength(0);
  });

  it('cascades the paired refresh token when its access token row is deleted', async () => {
    const userId = await createUser('oauth-token-cascade');
    await registerClient();

    await stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: 'access-hash-3',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
      refreshToken: {
        refreshTokenHash: 'refresh-hash-3',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        accessTokenHash: 'access-hash-3',
        familyId: 'family-3',
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    // Deleting the access-token row must remove its paired refresh token: this
    // is the `refresh -> access` ON DELETE CASCADE added in
    // `@lostgradient/mcp@0.2.1`, without which a refresh token could outlive
    // the access token it points at.
    await testDatabase.db
      .delete(oauthAccessTokens)
      .where(eq(oauthAccessTokens.accessTokenHash, 'access-hash-3'));

    const refreshRows = await testDatabase.db.select().from(oauthRefreshTokens);
    expect(refreshRows).toHaveLength(0);
  });

  it('rotates a refresh token within its family and revokes the family on replay', async () => {
    const userId = await createUser('oauth-refresh-lineage');
    await registerClient();

    await stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: 'access-hash-root',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
      refreshToken: {
        refreshTokenHash: 'refresh-hash-root',
        clientId: CLIENT_ID,
        userId: String(userId),
        scope: 'repositories:read',
        resource: RESOURCE,
        accessTokenHash: 'access-hash-root',
        familyId: 'family-root',
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    const rotation = await stores.tokens.rotateRefreshToken({
      priorHash: 'refresh-hash-root',
      clientId: CLIENT_ID,
      resource: RESOURCE,
      nextAccessTokenHash: 'access-hash-rotated',
      nextRefreshTokenHash: 'refresh-hash-rotated',
      accessTokenExpiresAt: hourFromNow(),
      refreshTokenExpiresAt: hourFromNow(),
      createdAt: new Date(),
    });

    expect(rotation.status).toBe('rotated');
    if (rotation.status === 'rotated') {
      // The replacement stays in the same family — that lineage is what makes
      // replay detection possible.
      expect(rotation.refreshToken.familyId).toBe('family-root');
      const parsed = oauthRefreshTokenRowSchema.parse(
        (
          await testDatabase.db
            .select()
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.refreshTokenHash, 'refresh-hash-rotated'))
        )[0],
      );
      expect(parsed.userId).toBe(userId);
    }

    // Replaying the already-rotated root token revokes the whole family.
    const replay = await stores.tokens.rotateRefreshToken({
      priorHash: 'refresh-hash-root',
      clientId: CLIENT_ID,
      resource: RESOURCE,
      nextAccessTokenHash: 'access-hash-replay',
      nextRefreshTokenHash: 'refresh-hash-replay',
      accessTokenExpiresAt: hourFromNow(),
      refreshTokenExpiresAt: hourFromNow(),
      createdAt: new Date(),
    });

    expect(replay.status).toBe('replay_revoked');
    if (replay.status === 'replay_revoked') {
      expect(replay.familyId).toBe('family-root');
    }

    // Revocation reached Tribunal's tables, not just the return value: the
    // rotated token in the family now carries a revocation timestamp.
    const [rotatedRow] = await testDatabase.db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.refreshTokenHash, 'refresh-hash-rotated'));
    expect(oauthRefreshTokenRowSchema.parse(rotatedRow).revokedAt).not.toBeNull();
  });
});
