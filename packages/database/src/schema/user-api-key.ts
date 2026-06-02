import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './user';

/**
 * User API keys for customer-facing API access.
 * Keys are user-scoped (not workspace/service-account) and use prefix-based lookup.
 * MVP: no audit logs, no lastUsedAt, no scopes (inherits user permissions).
 */
export const userApiKey = pgTable(
  'user_api_key',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    keyHash: varchar('key_hash', { length: 64 }).notNull(), // SHA-256 hex (64 chars)
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull().unique(), // Format: "uak_<12hex>"
    // Future expansion (nullable for MVP)
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Index for user lookup
    index('user_api_key_user_idx').on(table.userId),
    // Composite index for list/count queries filtering active keys by user
    index('user_api_key_user_id_revoked_at_idx').on(table.userId, table.revokedAt),
    // Composite index for revoke/rotate ownership verification
    index('user_api_key_user_id_id_idx').on(table.userId, table.id),
    // Partial index for active keys (most queries filter by revoked)
    index('user_api_key_prefix_active_idx')
      .on(table.keyPrefix)
      .where(sql`${table.revokedAt} IS NULL`),
    // DB-level prefix format validation
    check('user_api_key_prefix_format', sql`key_prefix ~ '^uak_[0-9a-f]{12}$'`),
    // Name cannot be empty
    check('user_api_key_name_not_empty', sql`length(trim(${table.name})) > 0`),
  ],
);

export type UserApiKey = typeof userApiKey.$inferSelect;
export type NewUserApiKey = typeof userApiKey.$inferInsert;
