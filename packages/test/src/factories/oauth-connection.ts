/**
 * OAuth connection factory for creating test OAuth connections.
 */
import { oauthConnection } from '@tribunal/database/schema';
import type { OAuthConnection } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type OAuthConnectionFactoryInput = Partial<{
  userId: number;
  provider: 'github';
  providerUserId: string;
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
}>;

export interface OAuthConnectionFactory {
  /** Create an OAuth connection */
  create(input: OAuthConnectionFactoryInput & { userId: number }): Promise<OAuthConnection>;
}

export function createOAuthConnectionFactory(db: Database): OAuthConnectionFactory {
  return {
    async create(input) {
      const id = generateId();
      const [connection] = await db
        .insert(oauthConnection)
        .values({
          userId: input.userId,
          provider: input.provider ?? 'github',
          providerUserId: input.providerUserId ?? `provider-user-${id}`,
          accessToken: input.accessToken ?? `test-access-token-${id}`,
          refreshToken: input.refreshToken ?? null,
          scope: input.scope ?? 'read:user,repo',
        })
        .returning();
      return connection;
    },
  };
}
