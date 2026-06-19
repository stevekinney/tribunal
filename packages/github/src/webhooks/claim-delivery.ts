/**
 * Webhook delivery idempotency.
 *
 * Atomically claims webhook deliveries to prevent duplicate processing
 * when GitHub retries or when multiple instances receive the same event.
 */

import { githubWebhookDelivery } from '@tribunal/database/schema';
import { and, eq } from 'drizzle-orm';
import type { GithubServiceContext } from '../context.js';

/**
 * Atomically try to claim a webhook delivery for processing.
 * Returns true if this caller should process the webhook (first to claim).
 * Returns false if another request already claimed it (duplicate).
 *
 * This avoids the race condition in check-then-record pattern by using
 * INSERT ... ON CONFLICT DO NOTHING and checking if a row was inserted.
 */
export async function claimWebhookDelivery(
  context: GithubServiceContext,
  deliveryId: string,
  eventType: string,
  installationId?: number,
): Promise<boolean> {
  // Try to insert. If conflict (already exists), no rows returned.
  const inserted = await context.db
    .insert(githubWebhookDelivery)
    .values({
      deliveryId,
      eventType,
      installationId,
    })
    .onConflictDoNothing()
    .returning({ id: githubWebhookDelivery.id });

  // If we got a row back, we successfully claimed this delivery
  return inserted.length > 0;
}

/**
 * Release a claimed delivery so GitHub redelivery can retry the same event.
 * Callers must only use this when downstream side effects are idempotent or
 * otherwise safe to repeat after a redelivery.
 */
export async function releaseWebhookDeliveryClaim(
  context: GithubServiceContext,
  deliveryId: string,
  eventType: string,
): Promise<boolean> {
  try {
    const deleted = await context.db
      .delete(githubWebhookDelivery)
      .where(
        and(
          eq(githubWebhookDelivery.deliveryId, deliveryId),
          eq(githubWebhookDelivery.eventType, eventType),
        ),
      )
      .returning({ id: githubWebhookDelivery.id });
    if (deleted.length > 0) return true;
    console.error('[github-webhook] Delivery claim release did not delete a row:', {
      deliveryId,
      eventType,
    });
    return false;
  } catch (error) {
    console.error('[github-webhook] Failed to release delivery claim:', {
      deliveryId,
      eventType,
      error,
    });
    return false;
  }
}
