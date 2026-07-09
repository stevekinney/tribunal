import { bigint, foreignKey, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { eventListenerDelivery } from './event-listener-delivery';
import { repository } from './repository';
import { repositoryEventListener } from './repository-event-listener';
import { tribunalRun } from './tribunal-run';
import { user } from './user';
import { webhookEvent } from './webhook-event';

/**
 * Webhook-event-handler-specific detail for a `tribunal_run` row, mirroring
 * `pull_request_review_run`'s pattern of denormalized `userId`/`repositoryId`
 * plus a composite FK back to the parent so those copies can never diverge.
 *
 * `eventListenerId` and `deliveryId` use `set null` on delete -- a run
 * already happened and is a historical record; deleting the listener
 * configuration that produced it (or having its delivery row cascade away
 * with the listener) must not delete the run's own audit trail.
 * `webhookEventId` cascades because a `webhook_event` only ever disappears
 * via its repository being deleted, at which point this run's parent
 * `tribunal_run` cascades away in the same transaction anyway.
 */
export const webhookEventHandlerRun = pgTable(
  'webhook_event_handler_run',
  {
    runId: text('run_id')
      .primaryKey()
      .references(() => tribunalRun.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    webhookEventId: integer('webhook_event_id')
      .notNull()
      .references(() => webhookEvent.id, { onDelete: 'cascade' }),
    eventListenerId: text('event_listener_id').references(() => repositoryEventListener.id, {
      onDelete: 'set null',
    }),
    deliveryId: integer('delivery_id').references(() => eventListenerDelivery.id, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').notNull(),
    action: text('action'),
  },
  (table) => [
    foreignKey({
      name: 'webhook_event_handler_run_run_user_repository_fk',
      columns: [table.runId, table.userId, table.repositoryId],
      foreignColumns: [tribunalRun.id, tribunalRun.userId, tribunalRun.repositoryId],
    }).onDelete('cascade'),
    index('webhook_event_handler_run_user_idx').on(table.userId),
    index('webhook_event_handler_run_repository_idx').on(table.repositoryId),
    index('webhook_event_handler_run_webhook_event_idx').on(table.webhookEventId),
    index('webhook_event_handler_run_event_listener_idx').on(table.eventListenerId),
    index('webhook_event_handler_run_delivery_idx').on(table.deliveryId),
  ],
);

export type WebhookEventHandlerRun = typeof webhookEventHandlerRun.$inferSelect;
export type NewWebhookEventHandlerRun = typeof webhookEventHandlerRun.$inferInsert;
