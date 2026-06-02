import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { oauthConnectionStatusEnum, oauthProviderEnum } from './enums';
import { user } from './user';

/**
 * OAuth API access tokens linking users to providers.
 *
 * Separate from auth_account (which tracks login identity). This table stores
 * the encrypted access/refresh tokens used to call provider APIs on behalf of
 * the user (for example, listing the repositories a user can reach on GitHub).
 *
 * Tokens are stored encrypted at rest; callers are responsible for
 * encryption/decryption.
 */
export const oauthConnection = pgTable(
  'oauth_connection',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: oauthProviderEnum('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    accessToken: text('access_token').notNull(), // Encrypted at rest
    refreshToken: text('refresh_token'), // Encrypted at rest, NULL when not provided
    expiresAt: timestamp('expires_at'),
    scope: text('scope'),
    status: oauthConnectionStatusEnum('status').notNull().default('active'),
    lastCheckedAt: timestamp('last_checked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One connection per provider per user
    uniqueIndex('oauth_connection_user_provider_idx').on(table.userId, table.provider),
    // Lookup connections by provider + provider user id (e.g., webhook revocation)
    index('oauth_connection_provider_user_idx').on(table.provider, table.providerUserId),
    index('oauth_connection_user_idx').on(table.userId),
  ],
);

export type OAuthConnection = typeof oauthConnection.$inferSelect;
export type NewOAuthConnection = typeof oauthConnection.$inferInsert;
