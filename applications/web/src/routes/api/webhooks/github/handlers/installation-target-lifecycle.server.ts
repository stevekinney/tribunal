/**
 * Installation target (renamed) webhook event handler.
 * Handles: installation_target.renamed
 *
 */

import type { InstallationTargetEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { updateInstallationAccountMetadata } from '@tribunal/github/installations/records';

/**
 * Handle installation_target webhook events.
 * Durable metadata writes throw on failures so ingress can release the delivery
 * claim and let GitHub redeliver.
 */
export async function handleInstallationTarget(
  payload: InstallationTargetEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, logger } = context;

  switch (action) {
    case 'renamed': {
      const { account } = payload;

      if (account?.login) {
        const result = await updateInstallationAccountMetadata(githubContext, {
          installationId,
          accountLogin: account.login,
          accountType: account.type as 'User' | 'Organization',
          accountId: account.id,
          accountAvatarUrl: account.avatar_url ?? null,
        });

        if (!result.updated) {
          logger.warn(
            { installationId, accountLogin: account.login },
            'Installation target rename metadata row not found',
          );
        }
      }

      logger.info(
        `Installation target renamed from ${payload.changes.login?.from} to ${payload.account?.login}`,
      );
      break;
    }

    default:
      logger.debug({ action }, 'Unhandled installation_target action');
  }
}
