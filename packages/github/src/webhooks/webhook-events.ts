import { webhookEvent } from '@tribunal/database/schema';
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
 * Store a webhook event.
 * Automatically creates/updates the repository record if needed.
 */
export async function storeWebhookEvent(
  context: GithubServiceContext,
  data: StoreWebhookEventData,
): Promise<void> {
  // Ensure repository exists (creates if not, updates metadata if changed)
  await getOrCreateRepository(
    context,
    data.repositoryId,
    data.repositoryOwner,
    data.repositoryName,
    data.installationId,
  );

  await context.db.insert(webhookEvent).values({
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
  });
}
