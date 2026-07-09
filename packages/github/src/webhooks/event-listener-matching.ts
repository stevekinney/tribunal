/**
 * Match a persisted `webhook_event` row against a repository's enabled
 * `repository_event_listener` rows and persist `pending` deliveries.
 *
 * This is the *only* event-listener work that happens inside the webhook
 * request/response path (see the "Events and Webhook-Triggered Agent Work"
 * section of the Phase Two plan). Execution -- claiming a pending row and
 * starting the agent run -- always happens afterward, via
 * `event-listener-dispatch.ts`.
 */
import {
  insertPendingEventListenerDeliveries,
  listEnabledListenersForRepositoryEventType,
  parseEventListenerFilters,
} from '@tribunal/database/queries';
import type {
  EventListenerDelivery,
  RepositoryEventListener,
  WebhookEvent,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';

/**
 * True if `listener` should fire for `event`: same event type (the caller
 * already filters on this via the query, but re-checked here so this
 * function is a correct standalone predicate), matching optional action,
 * and every named filter the listener declares matches the event's
 * normalized field exactly.
 */
export function eventListenerMatchesEvent(
  listener: Pick<RepositoryEventListener, 'eventType' | 'action' | 'filtersJson'>,
  event: Pick<
    WebhookEvent,
    'eventType' | 'action' | 'ref' | 'prNumber' | 'issueNumber' | 'senderLogin'
  >,
): boolean {
  if (listener.eventType !== event.eventType) return false;
  if (listener.action !== null && listener.action !== event.action) return false;

  const filters = parseEventListenerFilters(listener.filtersJson);
  // Unparseable stored filters fail closed: a corrupt row must not silently
  // widen to "matches everything of this event type/action".
  if (filters === null) return false;

  if (filters.ref !== undefined && filters.ref !== event.ref) return false;
  if (filters.prNumber !== undefined && filters.prNumber !== event.prNumber) return false;
  if (filters.issueNumber !== undefined && filters.issueNumber !== event.issueNumber) return false;
  if (filters.senderLogin !== undefined && filters.senderLogin !== event.senderLogin) return false;

  return true;
}

/**
 * Match enabled listeners for `event`'s repository against `event`, and
 * insert `pending` `event_listener_delivery` rows for every match. Returns
 * only the deliveries newly inserted -- a redelivered webhook re-matching
 * the same listener against the same (already-persisted) event hits the
 * `(listener_id, webhook_event_id)` unique constraint and is silently
 * skipped, never duplicated.
 */
export async function matchAndPersistEventListenerDeliveries(
  context: GithubServiceContext,
  event: WebhookEvent,
): Promise<EventListenerDelivery[]> {
  const candidates = await listEnabledListenersForRepositoryEventType(
    context.db,
    event.repositoryId,
    event.eventType,
  );

  const matchedListenerIds = candidates
    .filter((listener) => eventListenerMatchesEvent(listener, event))
    .map((listener) => listener.id);

  if (matchedListenerIds.length === 0) return [];

  return insertPendingEventListenerDeliveries(context.db, matchedListenerIds, event.id);
}
