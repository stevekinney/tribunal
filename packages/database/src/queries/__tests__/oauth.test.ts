import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// `@tribunal/test` is resolved via the workspace hoist rather than declared in
// this package's devDependencies, matching every other database test that uses
// it. It cannot be declared here: `@tribunal/test` depends on
// `@tribunal/database`, so a back-dependency would create a package cycle.
import { Pool as NeonServerlessPool } from '@neondatabase/serverless';
import { Pool as NodePostgresPool } from 'pg';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createDatabase } from '../../connection';
import { eq } from '../../operators';
import { user } from '../../schema/user';
import { oauthRefreshTokens } from '../../schema/oauth';
import { createOAuthStorageSeam, createOAuthStores, type OAuthDatabase } from '../oauth';

/** Reads the drizzle instance's underlying driver client for driver-selection assertions. */
function driverClient(database: OAuthDatabase): unknown {
  return (database as { $client?: unknown }).$client;
}

/**
 * This is the wiring check the library's own suite structurally cannot perform:
 * it drives the library's stores through Tribunal's storage seam against
 * Tribunal's real tables. Crucially it exercises the transaction path
 * (`rotateRefreshToken`), because the whole reason the seam exists is that the
 * adapter requires an interactive-transaction driver and Tribunal's main
 * `neon-http` connection has none — a test that only inserted a row would pass
 * on a driver that can never serve production.
 */

let testDatabase: TestDatabase;

const CLIENT_ID = 'seam-client';
const RESOURCE = 'https://tribunal.example/mcp';

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
});

function hourFromNow(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

describe('createOAuthStores', () => {
  it('drives the library stores through a transaction against Tribunal tables', async () => {
    // PGlite supports interactive transactions, so it stands in for the
    // production neon-serverless driver here.
    const stores = createOAuthStores(testDatabase.db);

    const [createdUser] = await testDatabase.db
      .insert(user)
      .values({ username: 'oauth-seam-user' })
      .returning({ id: user.id });
    const userId = String(createdUser!.id);

    await stores.clients.register({
      clientId: CLIENT_ID,
      clientSecretHash: 'hash',
      clientName: 'Seam Client',
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

    await stores.tokens.issueAuthorizationGrant({
      accessToken: {
        accessTokenHash: 'access-root',
        clientId: CLIENT_ID,
        userId,
        scope: 'repositories:read',
        resource: RESOURCE,
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
      refreshToken: {
        refreshTokenHash: 'refresh-root',
        clientId: CLIENT_ID,
        userId,
        scope: 'repositories:read',
        resource: RESOURCE,
        accessTokenHash: 'access-root',
        familyId: 'family-root',
        expiresAt: hourFromNow(),
        revokedAt: null,
        createdAt: new Date(),
      },
    });

    // The transaction path: rotate the refresh token, then read the replacement
    // back through Drizzle against Tribunal's schema.
    const rotation = await stores.tokens.rotateRefreshToken({
      priorHash: 'refresh-root',
      clientId: CLIENT_ID,
      resource: RESOURCE,
      nextAccessTokenHash: 'access-rotated',
      nextRefreshTokenHash: 'refresh-rotated',
      accessTokenExpiresAt: hourFromNow(),
      refreshTokenExpiresAt: hourFromNow(),
      createdAt: new Date(),
    });

    expect(rotation.status).toBe('rotated');
    const [rotated] = await testDatabase.db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.refreshTokenHash, 'refresh-rotated'));
    expect(rotated?.familyId).toBe('family-root');
    expect(rotated?.userId).toBe(createdUser!.id);
  });

  it('surfaces the failure when wired to a transactionless driver', async () => {
    // Regression guard for the bug class this seam exists to prevent: the
    // adapter requires `.transaction()`, and `neon-http` throws on it. A stub
    // that reproduces that failure proves a token mutation surfaces it loudly
    // rather than being hidden by a transaction-capable test driver.
    const neonHttpLike = {
      execute: async () => [],
      transaction: async () => {
        throw new Error('No transactions support in neon-http driver');
      },
    } as unknown as OAuthDatabase;

    const stores = createOAuthStores(neonHttpLike);
    await expect(stores.tokens.revokeFamily('any-family')).rejects.toThrow(
      'No transactions support in neon-http driver',
    );
  });

  it('refuses a real neon-http database at construction', () => {
    // The enforced guard: passing Tribunal's actual neon-http connection must
    // fail loudly where it is wired, not on the first production revocation.
    // The string form of createDatabase returns a real NeonHttpDatabase
    // instance (a thunk would return a lazy Proxy), constructed lazily so no
    // connection is opened.
    const neonHttpDatabase = createDatabase(
      'postgresql://user:pass@ep-test.neon.tech/db',
    ) as unknown as OAuthDatabase;
    expect(() => createOAuthStores(neonHttpDatabase)).toThrow(
      'requires an interactive-transaction driver',
    );
  });
});

describe('createOAuthStorageSeam', () => {
  it('selects the neon-serverless driver for a Neon host', async () => {
    // The pool connects lazily, so construction does no I/O and disposing an
    // unused pool resolves without a network round-trip.
    const seam = createOAuthStorageSeam('postgresql://user:pass@ep-test.neon.tech/db');
    // The underlying client proves the driver, not just that a function exists.
    expect(driverClient(seam.database)).toBeInstanceOf(NeonServerlessPool);
    await expect(seam.dispose()).resolves.toBeUndefined();
  });

  it('selects the node-postgres driver for a non-Neon host', async () => {
    const seam = createOAuthStorageSeam('postgresql://user:pass@localhost:5432/db');
    expect(driverClient(seam.database)).toBeInstanceOf(NodePostgresPool);
    await expect(seam.dispose()).resolves.toBeUndefined();
  });
});
