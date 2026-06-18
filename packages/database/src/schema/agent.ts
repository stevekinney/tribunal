import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './user';

export const agent = pgTable(
  'agent',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    model: text('model').notNull().default('inherit'),
    effort: text('effort'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('agent_user_slug_idx').on(table.userId, table.slug),
    index('agent_user_idx').on(table.userId),
    check(
      'agent_model_check',
      sql`${table.model} ~ '^(sonnet|opus|haiku|fable|inherit|claude-[a-z0-9-]+)$'`,
    ),
    check(
      'agent_effort_check',
      sql`${table.effort} IS NULL OR ${table.effort} IN ('low','medium','high','xhigh','max')`,
    ),
  ],
);

export type Agent = typeof agent.$inferSelect;
export type NewAgent = typeof agent.$inferInsert;
