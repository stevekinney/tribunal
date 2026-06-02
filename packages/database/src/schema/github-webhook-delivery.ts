import { bigint, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Webhook delivery tracking for idempotency.
 * Keyed by GitHub's delivery GUID + event type.
 */
export const githubWebhookDelivery = pgTable(
  'github_webhook_delivery',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    // GitHub's unique delivery ID
    deliveryId: text('delivery_id').notNull(),

    // Event type (installation, installation_repositories, etc.)
    eventType: text('event_type').notNull(),

    // Processing status
    processedAt: timestamp('processed_at').notNull().defaultNow(),

    // Optional: store if we need to replay
    installationId: bigint('installation_id', { mode: 'number' }),
  },
  (table) => [
    // Idempotency key: same delivery + event = skip
    uniqueIndex('github_webhook_delivery_unique').on(table.deliveryId, table.eventType),
  ],
);

export type GitHubWebhookDelivery = typeof githubWebhookDelivery.$inferSelect;
export type NewGitHubWebhookDelivery = typeof githubWebhookDelivery.$inferInsert;
