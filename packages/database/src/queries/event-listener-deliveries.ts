/**
 * `event_listener_delivery` queries: matching, atomic claiming, and the
 * retry/abandon status machine.
 *
 * The claim is a compare-and-set expressed entirely in the `UPDATE ... WHERE`
 * clause (`status IN ('pending','retryable')`). Postgres row-level locking
 * on the UPDATE means only one concurrent caller's statement can match and
 * mutate a given row -- the second caller's `WHERE` simply no longer matches
 * once the first commits, so it gets zero rows back rather than a race.
 */

import { and, eq, inArray, lt, or, sql } from '../operators';
import type { Database } from '../connection';
import {
  eventListenerDelivery,
  type EventListenerDelivery,
} from '../schema/event-listener-delivery';
import { repositoryEventListener } from '../schema/repository-event-listener';
import { agent } from '../schema/agent';

/** Retries cap at this many attempts, after which a delivery is abandoned. */
export const MAX_EVENT_LISTENER_DELIVERY_ATTEMPTS = 5;

/**
 * A `running` delivery whose `started_at` is older than this is considered
 * abandoned by whatever process claimed it (crash, killed process,
 * interrupted fire-and-forget drain) rather than genuinely still in
 * progress, and becomes claimable again. There is no heartbeat -- dispatch
 * is expected to be fast (a handful of inserts), so this is generous
 * relative to normal dispatch latency while still bounding how long a
 * crashed claim can strand a delivery.
 */
export const STALE_RUNNING_DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Claimable status condition shared by the candidate read and the atomic
 * claim itself: `pending`/`retryable` rows, plus `running` rows whose claim
 * is older than {@link STALE_RUNNING_DELIVERY_TIMEOUT_MS} (presumed
 * abandoned by a crashed or interrupted dispatch).
 */
function claimableStatusCondition(now: Date, staleTimeoutMs: number) {
  const staleCutoff = new Date(now.getTime() - staleTimeoutMs);
  return or(
    inArray(eventListenerDelivery.status, ['pending', 'retryable']),
    and(
      eq(eventListenerDelivery.status, 'running'),
      lt(eventListenerDelivery.startedAt, staleCutoff),
    ),
  );
}

/**
 * Insert `pending` delivery rows for every matched listener against a
 * webhook event. Uses `onConflictDoNothing` on the `(listener_id,
 * webhook_event_id)` unique constraint so a redelivered webhook that matches
 * the same listener against the same event never creates duplicate work --
 * the conflicting insert is silently skipped, not retried or errored.
 *
 * Returns only the rows actually inserted (i.e. newly matched work), not
 * rows skipped by the conflict.
 */
export async function insertPendingEventListenerDeliveries(
  database: Database,
  listenerIds: string[],
  webhookEventId: number,
): Promise<EventListenerDelivery[]> {
  if (listenerIds.length === 0) return [];

  return database
    .insert(eventListenerDelivery)
    .values(
      listenerIds.map((listenerId) => ({
        listenerId,
        webhookEventId,
      })),
    )
    .onConflictDoNothing()
    .returning();
}

/**
 * Row shape returned by `listClaimableEventListenerDeliveries`: the delivery
 * plus enough listener/agent state for the caller to re-verify eligibility
 * before doing any work.
 */
export interface ClaimableEventListenerDelivery {
  delivery: EventListenerDelivery;
  listenerId: string;
  listenerEnabled: boolean;
  agentId: string;
  agentEnabled: boolean;
}

/**
 * Find `pending`/`retryable` rows (plus stale `running` rows abandoned by a
 * crashed or interrupted dispatch -- see {@link STALE_RUNNING_DELIVERY_TIMEOUT_MS})
 * eligible for a claim attempt, scoped to a repository and bounded to
 * `limit` rows. This is a read used to drive a bounded post-response drain --
 * it does not itself claim anything, so multiple concurrent drains may see
 * the same candidate rows; the actual claim (`claimEventListenerDelivery`)
 * is what resolves the race.
 */
export async function listClaimableEventListenerDeliveries(
  database: Database,
  repositoryId: number,
  limit: number,
  options: { now?: Date; staleTimeoutMs?: number } = {},
): Promise<ClaimableEventListenerDelivery[]> {
  const now = options.now ?? new Date();
  const staleTimeoutMs = options.staleTimeoutMs ?? STALE_RUNNING_DELIVERY_TIMEOUT_MS;

  const rows = await database
    .select({
      delivery: eventListenerDelivery,
      listenerId: repositoryEventListener.id,
      listenerEnabled: repositoryEventListener.enabled,
      agentId: agent.id,
      agentEnabled: agent.enabled,
    })
    .from(eventListenerDelivery)
    .innerJoin(
      repositoryEventListener,
      eq(eventListenerDelivery.listenerId, repositoryEventListener.id),
    )
    .innerJoin(agent, eq(repositoryEventListener.agentId, agent.id))
    .where(
      and(
        eq(repositoryEventListener.repositoryId, repositoryId),
        claimableStatusCondition(now, staleTimeoutMs),
      ),
    )
    .limit(limit);

  return rows;
}

/**
 * Atomically claim a single `pending`/`retryable` (or stale `running`)
 * delivery for execution. Returns null if another caller already claimed it
 * (or it moved to a terminal state, or is `running` but not yet stale)
 * between the read and this call.
 */
export async function claimEventListenerDelivery(
  database: Database,
  deliveryId: number,
  options: { now?: Date; staleTimeoutMs?: number } = {},
): Promise<EventListenerDelivery | null> {
  const now = options.now ?? new Date();
  const staleTimeoutMs = options.staleTimeoutMs ?? STALE_RUNNING_DELIVERY_TIMEOUT_MS;
  const claimedAt = new Date();

  const [row] = await database
    .update(eventListenerDelivery)
    .set({
      status: 'running',
      claimedAt,
      startedAt: claimedAt,
      attemptCount: sql`${eventListenerDelivery.attemptCount} + 1`,
    })
    .where(
      and(eq(eventListenerDelivery.id, deliveryId), claimableStatusCondition(now, staleTimeoutMs)),
    )
    .returning();

  return row ?? null;
}

export async function markEventListenerDeliverySucceeded(
  database: Database,
  deliveryId: number,
  runId: string,
): Promise<void> {
  await database
    .update(eventListenerDelivery)
    .set({ status: 'succeeded', runId, finishedAt: new Date(), lastError: null })
    .where(eq(eventListenerDelivery.id, deliveryId));
}

/**
 * Record a dispatch/execution failure. Moves to `retryable` while under the
 * attempt cap so a later drain can pick it back up, or `abandoned` once the
 * cap is reached so operators see a terminal, visible failure instead of an
 * endlessly retried row.
 */
/**
 * Small display vocabulary shared by every surface that shows event listener
 * progress (the repository events page and both webhook event pages): a
 * delivery is `matched` until dispatch durably creates a run, after which the
 * run's own lifecycle status takes over.
 */
export type EventListenerDisplayStatus =
  | 'matched'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/**
 * Maps a delivery's dispatch status (`event_listener_delivery.status`) and,
 * once dispatch has durably created a run, that run's own lifecycle status
 * (`tribunal_run.status`) onto the small display vocabulary above.
 *
 * This is the single source of truth for that mapping -- both the repository
 * events page (last run status per listener) and the webhook event progress
 * views (per-delivery match status) call this rather than each re-deriving
 * their own notion of "failed" or "queued".
 */
export function deriveEventListenerDisplayStatus(
  deliveryStatus: string,
  runStatus: string | null,
): EventListenerDisplayStatus {
  if (deliveryStatus === 'pending' || deliveryStatus === 'running') {
    // Matched, but dispatch has not yet durably created a run (still
    // pending, or a claim is in flight).
    return 'matched';
  }

  if (
    deliveryStatus === 'retryable' ||
    deliveryStatus === 'abandoned' ||
    deliveryStatus === 'failed'
  ) {
    // Dispatch itself failed (transient-and-retryable, or terminal). Either
    // way there is no run to reflect, so the dispatch outcome is the status.
    return 'failed';
  }

  // deliveryStatus === 'succeeded': dispatch durably created a run. Reflect
  // that run's own lifecycle status rather than the (now uninteresting)
  // dispatch outcome.
  switch (runStatus) {
    case 'running':
      return 'running';
    case 'posted':
    case 'superseded':
      return 'succeeded';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'quota_blocked':
      return 'failed';
    case 'queued':
    default:
      return 'queued';
  }
}

export async function markEventListenerDeliveryFailed(
  database: Database,
  deliveryId: number,
  errorMessage: string,
  options?: { maxAttempts?: number },
): Promise<EventListenerDelivery | null> {
  const maxAttempts = options?.maxAttempts ?? MAX_EVENT_LISTENER_DELIVERY_ATTEMPTS;

  const [current] = await database
    .select({ attemptCount: eventListenerDelivery.attemptCount })
    .from(eventListenerDelivery)
    .where(eq(eventListenerDelivery.id, deliveryId))
    .limit(1);

  if (!current) return null;

  const nextStatus = current.attemptCount >= maxAttempts ? 'abandoned' : 'retryable';

  const [row] = await database
    .update(eventListenerDelivery)
    .set({ status: nextStatus, lastError: errorMessage, finishedAt: new Date() })
    .where(eq(eventListenerDelivery.id, deliveryId))
    .returning();

  return row ?? null;
}
