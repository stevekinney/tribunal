/**
 * Webhook delivery factory for creating test GitHub webhook deliveries.
 */
import { githubWebhookDelivery } from '@tribunal/database/schema';
import type { GitHubWebhookDelivery } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type WebhookDeliveryFactoryInput = Partial<{
  deliveryId: string;
  eventType: string;
  installationId: number | null;
}>;

export interface WebhookDeliveryFactory {
  /** Create a webhook delivery record (for idempotency testing) */
  create(input?: WebhookDeliveryFactoryInput): Promise<GitHubWebhookDelivery>;
  /** Create delivery for a specific event type */
  createForEvent(eventType: string, installationId?: number): Promise<GitHubWebhookDelivery>;
}

export function createWebhookDeliveryFactory(db: Database): WebhookDeliveryFactory {
  return {
    async create(input = {}) {
      const id = generateId();
      const [delivery] = await db
        .insert(githubWebhookDelivery)
        .values({
          deliveryId: input.deliveryId ?? `delivery-${id}-${Date.now()}`,
          eventType: input.eventType ?? 'push',
          installationId: input.installationId ?? null,
        })
        .returning();
      return delivery;
    },

    async createForEvent(eventType, installationId) {
      return this.create({
        eventType,
        installationId: installationId ?? null,
      });
    },
  };
}
