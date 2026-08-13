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
}>;

export interface WebhookDeliveryFactory {
  /** Create a webhook delivery record (for idempotency testing) */
  create(input?: WebhookDeliveryFactoryInput): Promise<GitHubWebhookDelivery>;
  /** Create delivery for a specific event type */
  createForEvent(eventType: string): Promise<GitHubWebhookDelivery>;
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
        })
        .returning();
      return delivery;
    },

    async createForEvent(eventType) {
      return this.create({ eventType });
    },
  };
}
