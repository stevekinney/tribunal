import { kickReviewEngine } from '$lib/server/review/engine-client';
import type { WebhookLogger } from './types';

type DurableReviewIntentResult = {
  enqueued: boolean;
  enqueueStatus?: string;
};

export function hasDurableReviewIntentForDrain(result: DurableReviewIntentResult): boolean {
  return result.enqueued || result.enqueueStatus === 'duplicate';
}

export async function kickReviewEngineAfterDurableIntent(
  result: DurableReviewIntentResult,
  logger: WebhookLogger,
): Promise<void> {
  if (!hasDurableReviewIntentForDrain(result)) return;
  await kickReviewEngineAfterDurableIntentCount(1, logger);
}

export async function kickReviewEngineAfterDurableIntentCount(
  durableIntentCount: number,
  logger: WebhookLogger,
): Promise<void> {
  if (durableIntentCount <= 0) return;

  const result = await kickReviewEngine();
  if (result.status === 'not_configured') {
    const error = new Error('Review engine control is not configured.');
    logger.error({ error }, 'Review engine kick failed');
    throw error;
  }
  if (result.status === 'sent' && !result.ok) {
    const error = new Error(`Review engine kick failed with status ${result.responseStatus}.`);
    logger.warn({ responseStatus: result.responseStatus }, 'Review engine kick failed');
    throw error;
  }
  if (result.status === 'failed') {
    logger.error({ error: result.error }, 'Review engine kick failed');
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
}
