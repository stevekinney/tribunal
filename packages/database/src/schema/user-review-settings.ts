import { sql } from 'drizzle-orm';
import { boolean, check, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './user';

export const userReviewSettings = pgTable(
  'user_review_settings',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    dailyCostCapUsd: numeric('daily_cost_cap_usd').notNull().default('25'),
    reviewsEnabled: boolean('reviews_enabled').notNull().default(true),
    defaultModel: text('default_model').notNull().default('claude-sonnet-4-6'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('user_review_settings_daily_cost_cap_check', sql`${table.dailyCostCapUsd} >= 0`),
  ],
);

export type UserReviewSettings = typeof userReviewSettings.$inferSelect;
export type NewUserReviewSettings = typeof userReviewSettings.$inferInsert;
