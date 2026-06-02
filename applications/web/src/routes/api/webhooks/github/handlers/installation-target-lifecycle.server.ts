/**
 * Installation target (renamed) webhook event handler.
 * Handles: installation_target.renamed
 *
 * Currently not implemented in existing webhook handler.
 */

import type { InstallationTargetEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';

/**
 * Handle installation_target webhook events.
 * Non-orchestrator events - already claimed early in ingress, log for observability.
 */
export async function handleInstallationTarget(
  payload: InstallationTargetEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  switch (action) {
    case 'renamed': {
      // Currently no specific handling needed - installation record will be updated on next sync
      logger.info(
        `Installation target renamed from ${payload.changes.login?.from} to ${payload.account?.login}`,
      );
      break;
    }

    default:
      logger.debug({ action }, 'Unhandled installation_target action');
  }
}
