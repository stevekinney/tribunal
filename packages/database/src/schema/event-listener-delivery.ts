import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { repositoryEventListener } from './repository-event-listener';
import { tribunalRun } from './tribunal-run';
import { webhookEvent } from './webhook-event';

/**
 * Tracks matching a `repository_event_listener` against a received
 * `webhook_event` through to execution. A row is inserted in `pending`
 * status the moment matching succeeds inside the webhook request -- that
 * insert is the *only* listener work that happens inside the webhook
 * response path. Everything else (claiming the row, starting the agent run,
 * advancing status) happens afterward via an atomic compare-and-set claim,
 * so a dispatch failure never touches the original GitHub delivery claim or
 * the webhook HTTP response.
 *
 * The unique `(listener_id, webhook_event_id)` constraint is the redelivery
 * guard: a redelivered webhook that matches the same listener against the
 * same (already-persisted) `webhook_event` row hits a conflict, not a
 * duplicate row.
 */
export const eventListenerDelivery = pgTable(
  'event_listener_delivery',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    listenerId: text('listener_id')
      .notNull()
      .references(() => repositoryEventListener.id, { onDelete: 'cascade' }),
    webhookEventId: integer('webhook_event_id')
      .notNull()
      .references(() => webhookEvent.id, { onDelete: 'cascade' }),
    // Set once a run is created for this delivery. Nullable until claimed;
    // `set null` on run delete so the delivery row (and its retry history)
    // survives even if the run row it produced is ever removed.
    runId: text('run_id').references(() => tribunalRun.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    matchedAt: timestamp('matched_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (table) => [
    unique('event_listener_delivery_listener_webhook_event_unique').on(
      table.listenerId,
      table.webhookEventId,
    ),
    index('event_listener_delivery_run_idx').on(table.runId),
    index('event_listener_delivery_status_idx').on(table.status),
    index('event_listener_delivery_listener_status_idx').on(table.listenerId, table.status),
    index('event_listener_delivery_webhook_event_idx').on(table.webhookEventId),
    check(
      'event_listener_delivery_status_check',
      sql`${table.status} IN ('pending','running','succeeded','failed','retryable','abandoned')`,
    ),
    check('event_listener_delivery_attempt_count_check', sql`${table.attemptCount} >= 0`),
  ],
);

export type EventListenerDelivery = typeof eventListenerDelivery.$inferSelect;
export type NewEventListenerDelivery = typeof eventListenerDelivery.$inferInsert;
