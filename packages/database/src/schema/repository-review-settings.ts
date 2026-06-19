import { sql } from 'drizzle-orm';
import { bigint, boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { repository } from './repository';

export const repositoryReviewSettings = pgTable('repository_review_settings', {
  repositoryId: bigint('repository_id', { mode: 'number' })
    .primaryKey()
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
});

export type RepositoryReviewSettings = typeof repositoryReviewSettings.$inferSelect;
export type NewRepositoryReviewSettings = typeof repositoryReviewSettings.$inferInsert;
