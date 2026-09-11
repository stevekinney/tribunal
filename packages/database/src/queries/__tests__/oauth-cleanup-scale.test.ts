import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// `@tribunal/test` is resolved via the workspace hoist rather than declared in
// this package's devDependencies, matching every other database test that uses
// it: `@tribunal/test` depends on `@tribunal/database`, so declaring it here
// would create a package cycle.
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { user } from '../../schema/user';
import {
  oauthAccessTokens,
  oauthAuthorizationTransactions,
  oauthCodes,
  oauthRefreshTokens,
} from '../../schema/oauth';
import { createOAuthStores } from '../oauth';

/**
 * TRI-51 AC4: prove the cleanup sweep's purge primitives against production-scale
 * data rather than a handful of rows. Each purged table is seeded past 1,000
 * rows — a mix of expired and live — and every `purgeExpired` must delete exactly
 * the expired rows and leave the live ones, at that scale and in bounded time.
 *
 * This drives the same `stores.<x>.purgeExpired(now)` calls the in-process sweep
 * (`applications/web/.../cleanup-scheduler.ts`) makes, through Tribunal's storage
 * seam against Tribunal's real tables, so it is the scale counterpart to the web
 * unit test of the scheduler's timing logic.
 */

const EXPIRED_ROWS = 1_000;
const LIVE_ROWS = 200;
const TOTAL_ROWS = EXPIRED_ROWS + LIVE_ROWS; // 1,200 per table — comfortably over 1,000.
const INSERT_CHUNK = 500;

const CLIENT_ID = 'scale-client';
const RESOURCE = 'https://tribunal.example/mcp';
const PAST = new Date(Date.now() - 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const CREATED = new Date(Date.now() - 2 * 60 * 60 * 1000);

let testDatabase: TestDatabase;
let userId: number;

/** Inserts `rows` in parameter-bounded chunks so a 1,000+ row seed stays under Postgres's bind limit. */
async function insertInChunks<Row>(
  table: Parameters<TestDatabase['db']['insert']>[0],
  rows: Row[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await testDatabase.db.insert(table).values(rows.slice(start, start + INSERT_CHUNK) as never);
  }
}

// PGlite cold-start plus a ~6,000-row seed exceeds the 5s per-test timeout under
// full-suite load, so build the database and seed once under the 30s hook budget.
beforeAll(async () => {
  testDatabase = await createTestDatabase();

  const [createdUser] = await testDatabase.db
    .insert(user)
    .values({ username: 'oauth-cleanup-scale-user' })
    .returning({ id: user.id });
  userId = createdUser!.id;

  const stores = createOAuthStores(testDatabase.db);
  await stores.clients.register({
    clientId: CLIENT_ID,
    clientSecretHash: 'hash',
    clientName: 'Scale Client',
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

  // `index < EXPIRED_ROWS` is expired; the rest are live. Hashes are unique so
  // each row is a distinct primary key.
  const expiresFor = (index: number): Date => (index < EXPIRED_ROWS ? PAST : FUTURE);

  await insertInChunks(
    oauthAuthorizationTransactions,
    Array.from({ length: TOTAL_ROWS }, (_row, index) => ({
      transactionIdHash: `txn-${index}`,
      csrfTokenHash: `csrf-${index}`,
      consentBindingHash: `consent-${index}`,
      userId,
      clientId: CLIENT_ID,
      redirectUri: 'https://tribunal.example/callback',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      state: null,
      issuer: 'https://tribunal.example',
      resource: RESOURCE,
      scope: 'repositories:read',
      expiresAt: expiresFor(index),
      consumedAt: null,
      createdAt: CREATED,
    })),
  );

  await insertInChunks(
    oauthCodes,
    Array.from({ length: TOTAL_ROWS }, (_row, index) => ({
      codeHash: `code-${index}`,
      clientId: CLIENT_ID,
      userId,
      redirectUri: 'https://tribunal.example/callback',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      scope: 'repositories:read',
      state: null,
      resource: RESOURCE,
      expiresAt: expiresFor(index),
      usedAt: null,
      createdAt: CREATED,
    })),
  );

  // Access tokens first — refresh tokens reference them by hash (FK). Each
  // refresh token is paired 1:1 with an access token of the same expiry, so an
  // expired access token is never shielded by a live refresh token (the
  // token-store purge retains an expired access token only while a live refresh
  // token still points at it). The namespaces therefore line up exactly.
  await insertInChunks(
    oauthAccessTokens,
    Array.from({ length: TOTAL_ROWS }, (_row, index) => ({
      accessTokenHash: `access-${index}`,
      clientId: CLIENT_ID,
      userId,
      scope: 'repositories:read',
      resource: RESOURCE,
      expiresAt: expiresFor(index),
      revokedAt: null,
      createdAt: CREATED,
    })),
  );

  await insertInChunks(
    oauthRefreshTokens,
    Array.from({ length: TOTAL_ROWS }, (_row, index) => ({
      refreshTokenHash: `refresh-${index}`,
      clientId: CLIENT_ID,
      userId,
      scope: 'repositories:read',
      resource: RESOURCE,
      accessTokenHash: `access-${index}`,
      familyId: `family-${index}`,
      expiresAt: expiresFor(index),
      revokedAt: null,
      createdAt: CREATED,
    })),
  );
}, 30_000);

afterAll(async () => {
  await testDatabase.close();
});

describe('OAuth cleanup purge at production scale (TRI-51 AC4)', () => {
  it('purges every expired transaction, code, access, and refresh token and keeps the live ones', async () => {
    const stores = createOAuthStores(testDatabase.db);
    const now = new Date();

    const purgedTransactions = await stores.transactions.purgeExpired(now);
    const purgedCodes = await stores.codes.purgeExpired(now);
    // The token store's purge is composite: expired refresh tokens plus expired
    // access tokens not pinned by a live refresh token.
    const purgedTokens = await stores.tokens.purgeExpired(now);

    expect(purgedTransactions).toBe(EXPIRED_ROWS);
    expect(purgedCodes).toBe(EXPIRED_ROWS);
    expect(purgedTokens).toBe(EXPIRED_ROWS * 2); // expired refresh + expired access

    // The live rows survive, and a second purge is a no-op — nothing expired
    // remains to delete.
    expect(await stores.transactions.purgeExpired(now)).toBe(0);
    expect(await stores.codes.purgeExpired(now)).toBe(0);
    expect(await stores.tokens.purgeExpired(now)).toBe(0);

    const remainingRefresh = await testDatabase.db.select().from(oauthRefreshTokens);
    const remainingAccess = await testDatabase.db.select().from(oauthAccessTokens);
    expect(remainingRefresh).toHaveLength(LIVE_ROWS);
    expect(remainingAccess).toHaveLength(LIVE_ROWS);
    // Every surviving token is live (expiry in the future).
    for (const row of remainingRefresh)
      expect(row.expiresAt.getTime()).toBeGreaterThan(now.getTime());
    for (const row of remainingAccess)
      expect(row.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
