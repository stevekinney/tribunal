/**
 * Executes matched event listener work outside the webhook response path.
 *
 * `drainEventListenerDeliveries` claims a bounded batch of `pending`/
 * `retryable` deliveries for a repository, re-verifies the listener and
 * agent are still enabled (they may have changed between matching and this
 * claim), and -- if so -- durably records a `tribunal_run` (kind
 * `webhook_event_handler`) plus its `agent_run` child, in `queued` status.
 *
 * That queued run is the boundary of this change. Actually starting the
 * Claude Agent SDK run for a `webhook_event_handler` run is a separate,
 * explicitly out-of-scope follow-up (analogous to the existing review-intent
 * consumer that drives `pull_request_review` runs) -- this module never
 * marks a `tribunal_run`/`agent_run` `succeeded` for work that did not
 * happen. `event_listener_delivery.status` tracks *dispatch* outcome only
 * (did matching -> claim -> run-row-creation succeed), which is a distinct,
 * narrower claim than "the agent finished."
 *
 * Never awaited from the webhook request itself -- call this the same way
 * the existing `dispatchPRStateTracking` fire-and-forget call is used, so a
 * slow or failing drain can never block or fail the webhook HTTP response.
 */
import { eq } from 'drizzle-orm';
import {
  claimEventListenerDelivery,
  listClaimableEventListenerDeliveries,
  markEventListenerDeliveryFailed,
  markEventListenerDeliverySucceeded,
} from '@tribunal/database/queries';
import {
  agent as agentTable,
  agentRun,
  eventListenerDelivery,
  repositoryEventListener,
  tribunalRun,
  webhookEvent,
  webhookEventHandlerRun,
} from '@tribunal/database/schema';
import { getRepositoryById } from '../repositories/service.js';
import type { GithubServiceContext } from '../context.js';
import { buildEventListenerPrompt } from './event-listener-prompt.js';

/** Bounds how many deliveries a single drain call will attempt. */
export const DEFAULT_EVENT_LISTENER_DRAIN_LIMIT = 10;

export interface DrainEventListenerDeliveriesResult {
  attempted: number;
  dispatched: number;
  skippedDisabled: number;
  failed: number;
}

/**
 * Thrown by `dispatchClaimedDelivery` when the listener or its agent is
 * disabled at the moment of dispatch. Kept distinct from a generic dispatch
 * failure so the drain can report it separately (`skippedDisabled`) --
 * it is an expected outcome of a race, not an error condition.
 */
class EventListenerDisabledError extends Error {}

export async function drainEventListenerDeliveries(
  context: GithubServiceContext,
  repositoryId: number,
  limit: number = DEFAULT_EVENT_LISTENER_DRAIN_LIMIT,
): Promise<DrainEventListenerDeliveriesResult> {
  const candidates = await listClaimableEventListenerDeliveries(context.db, repositoryId, limit);

  const result: DrainEventListenerDeliveriesResult = {
    attempted: 0,
    dispatched: 0,
    skippedDisabled: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    const claimed = await claimEventListenerDelivery(context.db, candidate.delivery.id);
    if (!claimed) continue; // Lost the race to another concurrent claimer, or already terminal.

    result.attempted += 1;

    try {
      // dispatchClaimedDelivery re-reads listener/agent state itself rather
      // than trusting `candidate`, which was read before this claim and may
      // be stale by the time we get here.
      const runId = await dispatchClaimedDelivery(context, claimed.id, candidate.listenerId);
      await markEventListenerDeliverySucceeded(context.db, claimed.id, runId);
      result.dispatched += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markEventListenerDeliveryFailed(context.db, claimed.id, message);
      if (error instanceof EventListenerDisabledError) {
        result.skippedDisabled += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
}

/**
 * Load everything needed to build the run for a claimed delivery, create the
 * `tribunal_run` + `webhook_event_handler_run` + `agent_run` rows, and
 * return the new run's id.
 *
 * Throws (rather than swallowing) on any missing referenced row -- a
 * claimed delivery whose listener/event/repository/agent vanished between
 * matching and claim is a dispatch failure, handled by the caller's
 * retry/abandon bookkeeping, not a silent no-op. Throws
 * `EventListenerDisabledError` specifically when the listener or its agent
 * is disabled -- re-checked here against a fresh read, not the possibly
 * stale pre-claim snapshot the caller holds.
 *
 * Neon's HTTP driver does not support multi-statement transactions, so the
 * three inserts below cannot be wrapped atomically. Instead, every id is
 * *deterministic* (derived only from `deliveryId`, no randomness) and every
 * insert uses `onConflictDoNothing`, so a retry after a partial failure
 * (crash, connection drop) reconciles cleanly: rows already written are
 * skipped, rows not yet written are created, and no attempt can produce two
 * different runs for the same delivery.
 */
async function dispatchClaimedDelivery(
  context: GithubServiceContext,
  deliveryId: number,
  listenerId: string,
): Promise<string> {
  const [listener] = await context.db
    .select()
    .from(repositoryEventListener)
    .where(eq(repositoryEventListener.id, listenerId))
    .limit(1);
  if (!listener) throw new Error(`Event listener ${listenerId} no longer exists`);
  if (!listener.enabled) {
    throw new EventListenerDisabledError('Event listener was disabled before dispatch');
  }

  const [delivery] = await context.db
    .select()
    .from(eventListenerDelivery)
    .where(eq(eventListenerDelivery.id, deliveryId))
    .limit(1);
  if (!delivery) throw new Error(`Delivery ${deliveryId} no longer exists`);

  const [event] = await context.db
    .select()
    .from(webhookEvent)
    .where(eq(webhookEvent.id, delivery.webhookEventId))
    .limit(1);
  if (!event) throw new Error(`Webhook event for delivery ${deliveryId} no longer exists`);

  const repositoryRow = await getRepositoryById(context, listener.repositoryId);
  if (!repositoryRow) throw new Error(`Repository ${listener.repositoryId} no longer exists`);

  const [agentRow] = await context.db
    .select()
    .from(agentTable)
    .where(eq(agentTable.id, listener.agentId))
    .limit(1);
  if (!agentRow) throw new Error(`Agent ${listener.agentId} no longer exists`);
  if (!agentRow.enabled) {
    throw new EventListenerDisabledError('Agent was disabled before dispatch');
  }

  // Built and validated so the prompt-construction contract stays testable
  // even though nothing consumes the result yet (see module docstring).
  buildEventListenerPrompt({
    agent: agentRow,
    listenerInstructionsMarkdown: listener.instructionsMarkdown,
    repository: repositoryRow,
    event,
  });

  const runId = `run:webhook:${deliveryId}`;

  await context.db
    .insert(tribunalRun)
    .values({
      id: runId,
      userId: listener.userId,
      repositoryId: listener.repositoryId,
      runKind: 'webhook_event_handler',
      status: 'queued',
    })
    .onConflictDoNothing();

  await context.db
    .insert(webhookEventHandlerRun)
    .values({
      runId,
      userId: listener.userId,
      repositoryId: listener.repositoryId,
      webhookEventId: event.id,
      eventListenerId: listener.id,
      deliveryId,
      eventType: event.eventType,
      action: event.action,
    })
    .onConflictDoNothing();

  await context.db
    .insert(agentRun)
    .values({
      id: `arun:webhook:${deliveryId}`,
      userId: listener.userId,
      runId,
      agentId: agentRow.id,
      role: 'specialist',
      status: 'queued',
    })
    .onConflictDoNothing();

  return runId;
}
