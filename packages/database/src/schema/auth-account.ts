import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { authProviderEnum } from './enums';
import { user } from './user';

/**
 * Authentication accounts linking users to OAuth providers.
 * Separate from oauth_connection which stores API access tokens.
 * This table tracks login identity for multi-provider authentication.
 */
export const authAccount = pgTable(
  'auth_account',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: authProviderEnum('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerUsername: text('provider_username'), // GitHub login for legacy invitation matching, NULL for Google
    email: text('email'), // May be NULL if provider doesn't provide email
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Global uniqueness: each provider account can only be linked once
    uniqueIndex('auth_account_provider_user_idx').on(table.provider, table.providerUserId),
    // Per-user uniqueness: one link per provider per user
    uniqueIndex('auth_account_user_provider_idx').on(table.userId, table.provider),
    // Index for user lookups
    index('auth_account_user_idx').on(table.userId),
  ],
);

export type AuthAccount = typeof authAccount.$inferSelect;
export type NewAuthAccount = typeof authAccount.$inferInsert;
