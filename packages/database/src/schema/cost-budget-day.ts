import { sql } from 'drizzle-orm';
import { check, integer, numeric, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';
import { user } from './user';

export const costBudgetDay = pgTable(
  'cost_budget_day',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dayStartedAt: timestamp('day_started_at', { withTimezone: true }).notNull(),
    spentUsd: numeric('spent_usd').notNull().default('0'),
    reservedUsd: numeric('reserved_usd').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.dayStartedAt] }),
    check('cost_budget_day_spent_usd_check', sql`${table.spentUsd} >= 0`),
    check('cost_budget_day_reserved_usd_check', sql`${table.reservedUsd} >= 0`),
  ],
);

export type CostBudgetDay = typeof costBudgetDay.$inferSelect;
export type NewCostBudgetDay = typeof costBudgetDay.$inferInsert;
