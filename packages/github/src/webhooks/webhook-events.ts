import { eq } from 'drizzle-orm';
import { webhookEvent, type WebhookEvent } from '@tribunal/database/schema';
import { getOrCreateRepository } from '../repositories/service.js';
import type { GithubServiceContext } from '../context.js';

export interface StoreWebhookEventData {
  eventType: string;
  action: string | null;
  deliveryId: string | null;
  payload: string;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  installationId: number | null;
  senderId: number | null;
  senderLogin: string | null;
  prNumber?: number;
  issueNumber?: number;
  ref?: string;
  commitSha?: string;
  githubCreatedAt?: Date;
}

/**
 * The subset of a persisted `webhook_event` row that callers -- notably
 * event listener matching -- actually need. Deliberately excludes `payload`:
 * that column can be large, and returning it on every webhook insert forces
 * Postgres to send it back over the wire even though nothing downstream of
 * `storeWebhookEvent` reads it.
 */
export type StoredWebhookEvent = Pick<
  WebhookEvent,
  | 'id'
  | 'repositoryId'
  | 'eventType'
  | 'action'
  | 'ref'
  | 'prNumber'
  | 'issueNumber'
  | 'senderLogin'
>;

const RETURNING_COLUMNS = {
  id: webhookEvent.id,
  repositoryId: webhookEvent.repositoryId,
  eventType: webhookEvent.eventType,
  action: webhookEvent.action,
  ref: webhookEvent.ref,
  prNumber: webhookEvent.prNumber,
  issueNumber: webhookEvent.issueNumber,
  senderLogin: webhookEvent.senderLogin,
};

/**
 * Store a webhook event.
 * Automatically creates/updates the repository record if needed.
 *
 * Returns the persisted row's identifying/matching fields (not the full row
 * -- see {@link StoredWebhookEvent}) so callers can reference it without a
 * second read.
 *
 * Idempotent on `deliveryId`: the webhook route retries this call a bounded
 * number of times on transient failure, and a retry can land after an
 * earlier attempt actually committed the insert but dropped the connection
 * before `.returning()` completed. A plain insert would then fail every
 * retry on the unique `delivery_id` constraint even though the row exists.
 * `onConflictDoNothing` + a re-select on conflict makes retries safe.
 */
export async function storeWebhookEvent(
  context: GithubServiceContext,
  data: StoreWebhookEventData,
): Promise<StoredWebhookEvent> {
  // Ensure repository exists (creates if not, updates metadata if changed)
  await getOrCreateRepository(
    context,
    data.repositoryId,
    data.repositoryOwner,
    data.repositoryName,
    data.installationId,
  );

  const inserted = await context.db
    .insert(webhookEvent)
    .values({
      eventType: data.eventType,
      action: data.action,
      deliveryId: data.deliveryId,
      payload: data.payload,
      repositoryId: data.repositoryId,
      installationId: data.installationId,
      senderId: data.senderId,
      senderLogin: data.senderLogin,
      prNumber: data.prNumber,
      issueNumber: data.issueNumber,
      ref: data.ref,
      commitSha: data.commitSha,
      githubCreatedAt: data.githubCreatedAt,
      receivedAt: new Date(),
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: webhookEvent.deliveryId })
    .returning(RETURNING_COLUMNS);

  if (inserted[0]) return inserted[0];

  // Conflicted with an existing row -- only possible when `deliveryId` is
  // set (multiple `null`s never conflict under a unique constraint), so this
  // is always safe to re-select by.
  if (!data.deliveryId) {
    throw new Error('storeWebhookEvent: insert conflicted without a deliveryId to re-select by');
  }

  const [existing] = await context.db
    .select(RETURNING_COLUMNS)
    .from(webhookEvent)
    .where(eq(webhookEvent.deliveryId, data.deliveryId))
    .limit(1);

  if (!existing) {
    throw new Error(
      `storeWebhookEvent: insert conflicted on delivery ${data.deliveryId} but no existing row was found`,
    );
  }

  return existing;
}
