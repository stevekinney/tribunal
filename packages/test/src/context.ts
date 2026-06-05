/**
 * Test context utilities for creating authenticated test scenarios.
 *
 * Provides a high-level API for common test patterns:
 * - Creating users with Neon Auth profile mappings
 * - Setting up workspaces with members
 * - Mocking authenticated requests
 */
import { createTestDatabase, type TestDatabase } from './database';
import { createFactories, resetIdCounter, type AllFactories } from './factories';
import type { User, OAuthConnection } from '@tribunal/database/schema';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type * as schema from '@tribunal/database/schema';

export type AuthenticatedUser = {
  user: User;
  neonAuthUserId: string;
  oauthConnection?: OAuthConnection;
};

export type TestContext = {
  /** The Drizzle database instance */
  db: PgliteDatabase<typeof schema>;
  /** All entity factories */
  factories: AllFactories;
  /** Reset all tables and ID counters */
  reset: () => Promise<void>;
  /** Close the database connection */
  close: () => Promise<void>;
  /**
   * Create a fully authenticated user with:
   * - User record
   * - Neon Auth profile mapping
   * - Optional OAuth connection
   */
  createAuthenticatedUser: (options?: {
    username?: string;
    neonAuthUserId?: string;
    withOAuth?: boolean;
    oauthScopes?: string;
  }) => Promise<AuthenticatedUser>;
};

/**
 * Creates a complete test context with database, factories, and helpers.
 *
 * This is the recommended way to set up tests:
 *
 * ```ts
 * import { createTestContext, type TestContext } from '@tribunal/test/context';
 *
 * describe('my feature', () => {
 *   let ctx: TestContext;
 *
 *   beforeAll(async () => {
 *     ctx = await createTestContext();
 *   });
 *
 *   afterAll(async () => {
 *     await ctx.close();
 *   });
 *
 *   beforeEach(async () => {
 *     await ctx.reset();
 *   });
 *
 *   it('works with authenticated user', async () => {
 *     const { user, neonAuthUserId } = await ctx.createAuthenticatedUser();
 *
 *     // User is fully set up with a Neon Auth mapping.
 *     expect(user.username).toBeDefined();
 *   });
 * });
 * ```
 */
export async function createTestContext(): Promise<TestContext> {
  const testDb: TestDatabase = await createTestDatabase();
  const factories = createFactories(testDb.db);

  const reset = async () => {
    await testDb.reset();
    resetIdCounter();
  };

  const close = async () => {
    await testDb.close();
  };

  const createAuthenticatedUser = async (
    options: {
      username?: string;
      neonAuthUserId?: string;
      withOAuth?: boolean;
      oauthScopes?: string;
    } = {},
  ): Promise<AuthenticatedUser> => {
    const {
      username,
      neonAuthUserId = `neon-user-${crypto.randomUUID()}`,
      withOAuth = false,
      oauthScopes = 'read:user,repo',
    } = options;

    const user = await factories.user.create({
      ...(username ? { username } : {}),
      neonAuthUserId,
    });

    // Optionally create OAuth connection
    let oauthConnection: OAuthConnection | undefined;
    if (withOAuth) {
      oauthConnection = await factories.oauthConnection.create({
        userId: user.id,
        provider: 'github',
        providerUserId: `github-${user.id}`,
        scope: oauthScopes,
      });
    }

    return {
      user,
      neonAuthUserId,
      oauthConnection,
    };
  };

  return {
    db: testDb.db,
    factories,
    reset,
    close,
    createAuthenticatedUser,
  };
}
