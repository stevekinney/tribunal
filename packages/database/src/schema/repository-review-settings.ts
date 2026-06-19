import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { repository } from './repository';
import { user } from './user';

export const repositoryReviewSettings = pgTable(
  'repository_review_settings',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    watched: boolean('watched').notNull().default(false),
    ignoreGlobs: text('ignore_globs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.repositoryId] }),
    index('repository_review_settings_repository_idx').on(table.repositoryId),
  ],
);

export type RepositoryReviewSettings = typeof repositoryReviewSettings.$inferSelect;
export type NewRepositoryReviewSettings = typeof repositoryReviewSettings.$inferInsert;
