/**
 * Installation repositories lifecycle webhook event handler.
 * Handles: installation_repositories.added, removed
 *
 * Adapted from existing handlers in applications/web/src/lib/server/github/webhooks/handlers/installation.ts
 */

import type { InstallationRepositoriesEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { handleRepositoriesRemoved } from '@tribunal/github/installations/lifecycle';
import { getPrimaryWorkspaceIdForInstallation } from '$lib/server/github/webhooks/handlers';
import { dispatchInstallationSync } from './installation-sync-dispatch';

/**
 * Handle installation_repositories webhook events.
 * Durable installation-sync events throw on dispatch failures so ingress can release the
 * delivery claim and let GitHub redeliver.
 */
export async function handleInstallationRepositories(
  payload: InstallationRepositoriesEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, logger, deliveryId } = context;

  switch (action) {
    case 'added': {
      // workspaceId is only needed for durable sync; resolve it here so a throw
      // only controls the sync metadata; dispatch failures still remain retryable.
      let workspaceId: number | undefined;
      try {
        workspaceId = await getPrimaryWorkspaceIdForInstallation(installationId);
      } catch (e) {
        logger.warn({ error: e }, 'Failed to resolve workspace for installation sync, skipping');
      }

      // Trigger sync to update repository list through the engine control channel.
      await dispatchInstallationSync(
        {
          installationId,
          reason: `webhook:installation_repositories.${action}`,
          workspaceId,
          deliveryId,
        },
        logger,
      );

      logger.info(`Installation ${installationId}: repositories added - triggering sync`);
      break;
    }

    case 'removed': {
      // Cancel workflows and mark repositories as inactive first — this is critical and must
      // not be blocked by workspace resolution. workspaceId is only needed for the subsequent
      // durable sync.
      const removedRepoIds = payload.repositories_removed.map((r) => r.id);
      await handleRepositoriesRemoved(githubContext, installationId, removedRepoIds);

      let workspaceId: number | undefined;
      try {
        workspaceId = await getPrimaryWorkspaceIdForInstallation(installationId);
      } catch (e) {
        logger.warn({ error: e }, 'Failed to resolve workspace for installation sync, skipping');
      }

      // Trigger sync to update repository list through the engine control channel.
      await dispatchInstallationSync(
        {
          installationId,
          reason: `webhook:installation_repositories.${action}`,
          workspaceId,
          deliveryId,
        },
        logger,
      );

      logger.info(
        `Installation ${installationId}: repositories removed - cancelling workflows and triggering sync`,
      );
      break;
    }

    default:
      logger.debug({ action }, 'Unhandled installation_repositories action');
  }
}
