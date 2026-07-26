/**
 * Shared installation-sync dispatch for webhook handlers.
 *
 * Every webhook handler that triggers an installation sync must go through this
 * helper so production web hands off to the engine receiver and turns failed
 * delivery into a retryable webhook failure instead of a claimed no-op.
 */
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync';
import { signalInstallationSyncEngine } from '$lib/server/review/engine-client';
import type { WebhookContext } from './types';

/**
 * Await installation sync dispatch through the engine control channel.
 * Missing configuration, failed HTTP delivery, and thrown fetch errors all
 * reject so the webhook route can release the claimed delivery and let GitHub
 * redeliver the event.
 */
export async function dispatchInstallationSync(
  options: EnqueueInstallationSyncOptions,
  logger: WebhookContext['logger'],
): Promise<void> {
  let result: Awaited<ReturnType<typeof signalInstallationSyncEngine>>;
  try {
    result = await signalInstallationSyncEngine(options);
  } catch (error) {
    logger.error({ error }, 'Installation sync engine dispatch failed');
    throw error;
  }

  if (result.status === 'not_configured') {
    const error = new Error(
      `Installation sync engine control is not configured. Missing settings: ${result.missingSettings.join(', ')}.`,
    );
    logger.error(
      { error, missingSettings: result.missingSettings },
      'Installation sync engine dispatch is not configured',
    );
    throw error;
  }

  if (result.status === 'failed') {
    const error = result.error instanceof Error ? result.error : new Error(String(result.error));
    logger.error({ error }, 'Installation sync engine dispatch failed');
    throw error;
  }

  if (!result.ok) {
    const error = new Error(
      `Installation sync engine dispatch failed with status ${result.responseStatus}.`,
    );
    logger.error(
      { responseStatus: result.responseStatus },
      'Installation sync engine dispatch failed',
    );
    throw error;
  }
}
