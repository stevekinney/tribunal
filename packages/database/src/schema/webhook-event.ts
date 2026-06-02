import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { repository } from './repository';

export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventType: text('event_type').notNull(),
    action: text('action'),
    deliveryId: text('delivery_id').unique(),
    payload: text('payload').notNull(),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    installationId: bigint('installation_id', { mode: 'number' }),
    senderId: bigint('sender_id', { mode: 'number' }),
    senderLogin: text('sender_login'),
    prNumber: integer('pr_number'),
    issueNumber: integer('issue_number'),
    ref: text('ref'),
    commitSha: text('commit_sha'),
    githubCreatedAt: timestamp('github_created_at'),
    receivedAt: timestamp('received_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('webhook_event_repository_type_idx').on(table.repositoryId, table.eventType),
    index('webhook_event_repository_received_idx').on(table.repositoryId, table.receivedAt),
    index('webhook_event_repository_created_idx').on(table.repositoryId, table.createdAt),
  ],
);

export type WebhookEvent = typeof webhookEvent.$inferSelect;
export type NewWebhookEvent = typeof webhookEvent.$inferInsert;
