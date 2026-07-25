/**
 * Shared installation-sync dispatch for webhook handlers.
 *
 * Every webhook handler that triggers an installation sync must go through this
 * helper so production web hands off to the engine receiver and logs failed
 * delivery instead of silently accepting a local no-op.
 */
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync';
import { signalInstallationSyncEngine } from '$lib/server/review/engine-client';
import type { WebhookContext } from './types';

/**
 * Fire-and-forget an installation sync through the engine control channel.
 * Dispatch remains off the webhook critical path, but missing configuration,
 * failed HTTP delivery, and thrown fetch errors are all logged as observable
 * failures.
 */
export function fireAndForgetInstallationSync(
  options: EnqueueInstallationSyncOptions,
  logger: WebhookContext['logger'],
): void {
  void signalInstallationSyncEngine(options)
    .then((result) => {
      if (result.status === 'not_configured') {
        logger.error(
          {
            error: new Error(
              `Installation sync engine control is not configured. Missing settings: ${result.missingSettings.join(', ')}.`,
            ),
            missingSettings: result.missingSettings,
          },
          'Installation sync engine dispatch is not configured',
        );
        return;
      }
      if (result.status === 'failed') {
        logger.error({ error: result.error }, 'Installation sync engine dispatch failed');
        return;
      }
      if (!result.ok) {
        logger.error(
          { responseStatus: result.responseStatus },
          'Installation sync engine dispatch failed',
        );
      }
    })
    .catch((error) => logger.error({ error }, 'Failed to enqueue installation sync'));
}
