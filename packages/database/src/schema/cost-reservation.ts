import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './user';

export const costReservation = pgTable(
  'cost_reservation',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dayStartedAt: timestamp('day_started_at', { withTimezone: true }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    amountUsd: numeric('amount_usd').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('cost_reservation_active_idempotency_key_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.releasedAt} IS NULL`),
    index('cost_reservation_user_day_active_idx').on(
      table.userId,
      table.dayStartedAt,
      table.releasedAt,
      table.expiresAt,
    ),
    check('cost_reservation_amount_usd_check', sql`${table.amountUsd} > 0`),
    check('cost_reservation_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export type CostReservation = typeof costReservation.$inferSelect;
export type NewCostReservation = typeof costReservation.$inferInsert;
