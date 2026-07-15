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

import { and, eq, inArray, lt, notInArray, or, sql } from '../operators';
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
 * webhook event. The `INSERT ... SELECT` snapshots each listener's owner and
 * name in the same statement, so a concurrent listener deletion either
 * leaves a complete historical row or inserts nothing. Uses
 * `onConflictDoNothing` on the `(listener_id, webhook_event_id)` unique
 * constraint so a redelivered webhook that matches the same listener against
 * the same event never creates duplicate work -- the conflicting insert is
 * silently skipped, not retried or errored.
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

  const result = await database.execute(sql`
    INSERT INTO ${eventListenerDelivery} (
      "listener_id",
      "listener_user_id",
      "listener_name",
      "webhook_event_id"
    )
    SELECT
      ${repositoryEventListener.id},
      ${repositoryEventListener.userId},
      ${repositoryEventListener.name},
      ${webhookEventId}
    FROM ${repositoryEventListener}
    WHERE ${inArray(repositoryEventListener.id, listenerIds)}
    ON CONFLICT ("listener_id", "webhook_event_id")
      DO NOTHING
    RETURNING
      ${eventListenerDelivery.id} AS "id",
      ${eventListenerDelivery.listenerId} AS "listenerId",
      ${eventListenerDelivery.listenerUserId} AS "listenerUserId",
      ${eventListenerDelivery.listenerName} AS "listenerName",
      ${eventListenerDelivery.webhookEventId} AS "webhookEventId",
      ${eventListenerDelivery.runId} AS "runId",
      ${eventListenerDelivery.status} AS "status",
      ${eventListenerDelivery.attemptCount} AS "attemptCount",
      ${eventListenerDelivery.matchedAt} AS "matchedAt",
      ${eventListenerDelivery.claimedAt} AS "claimedAt",
      ${eventListenerDelivery.startedAt} AS "startedAt",
      ${eventListenerDelivery.finishedAt} AS "finishedAt",
      ${eventListenerDelivery.lastError} AS "lastError"
  `);

  return getRows<EventListenerDelivery>(result);
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
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
 *
 * `excludeIds` lets a multi-round drain within a single call exclude rows it
 * already attempted (and which may have become claimable again, e.g. moved
 * to `retryable` by a failed dispatch) at the database level -- filtering
 * those out of an already-fetched, limit-bounded page can silently starve a
 * later round (the page can be entirely attempted ids, or short enough that
 * the caller's "short page means drained" check trips early) while
 * genuinely-unattempted rows sit beyond that page.
 */
export async function listClaimableEventListenerDeliveries(
  database: Database,
  repositoryId: number,
  limit: number,
  options: { now?: Date; staleTimeoutMs?: number; excludeIds?: number[] } = {},
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
        options.excludeIds && options.excludeIds.length > 0
          ? notInArray(eventListenerDelivery.id, options.excludeIds)
          : undefined,
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

/**
 * Mark a claimed delivery `succeeded`. When `expectedAttemptCount` is given,
 * the update only applies if the row is still `running` at that exact
 * attempt count -- the value `claimEventListenerDelivery` incremented to and
 * returned for this specific claim. Without that guard, a claimant whose
 * claim went stale (past {@link STALE_RUNNING_DELIVERY_TIMEOUT_MS}) and was
 * reclaimed by a second caller could still finish its own (abandoned) work
 * afterward and overwrite the second claimant's result purely by matching
 * `deliveryId`, even though the row had already moved past that claim.
 */
export async function markEventListenerDeliverySucceeded(
  database: Database,
  deliveryId: number,
  runId: string,
  expectedAttemptCount?: number,
): Promise<void> {
  await database
    .update(eventListenerDelivery)
    .set({ status: 'succeeded', runId, finishedAt: new Date(), lastError: null })
    .where(
      and(
        eq(eventListenerDelivery.id, deliveryId),
        eq(eventListenerDelivery.status, 'running'),
        expectedAttemptCount === undefined
          ? undefined
          : eq(eventListenerDelivery.attemptCount, expectedAttemptCount),
      ),
    );
}

/**
 * Record a dispatch/execution failure. Moves to `retryable` while under the
 * attempt cap so a later drain can pick it back up, or `abandoned` once the
 * cap is reached so operators see a terminal, visible failure instead of an
 * endlessly retried row.
 *
 * When `options.expectedAttemptCount` is given, the terminal write only
 * applies if the row is still `running` at that exact attempt count -- see
 * {@link markEventListenerDeliverySucceeded} for why this guard matters (a
 * stale claimant finishing after its claim was reclaimed must not clobber
 * the reclaiming caller's outcome).
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
  listenerDeleted = false,
): EventListenerDisplayStatus {
  if (
    listenerDeleted &&
    (deliveryStatus === 'pending' || deliveryStatus === 'running' || deliveryStatus === 'retryable')
  ) {
    // Deleting a listener cancels work that has not durably created a run.
    // The preserved delivery row remains an audit record, but its nullable
    // listener reference keeps it out of the claim query so it cannot run.
    return 'cancelled';
  }

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
  options?: { maxAttempts?: number; expectedAttemptCount?: number },
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
    .where(
      and(
        eq(eventListenerDelivery.id, deliveryId),
        eq(eventListenerDelivery.status, 'running'),
        options?.expectedAttemptCount === undefined
          ? undefined
          : eq(eventListenerDelivery.attemptCount, options.expectedAttemptCount),
      ),
    )
    .returning();

  return row ?? null;
}
