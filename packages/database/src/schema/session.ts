import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './user';

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(), // Auth libraries generate session IDs
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    lastAuthAt: timestamp('last_auth_at').notNull().defaultNow(), // For re-auth checks
  },
  (table) => [index('session_user_idx').on(table.userId)],
);

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
