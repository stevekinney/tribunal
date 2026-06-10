/**
 * Installation lifecycle webhook event handler.
 * Handles: installation.created, deleted, suspend, unsuspend, new_permissions_accepted
 *
 * Adapted from existing handlers in applications/web/src/lib/server/github/webhooks/handlers/installation.ts
 */

import type { InstallationEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import {
  upsertInstallation,
  updateInstallationStatus,
} from '@tribunal/github/installations/records';
import {
  handleInstallationDeleted,
  handleInstallationSuspend,
  handleInstallationUnsuspend,
} from '@tribunal/github/installations/lifecycle';
import { enqueueInstallationSync } from '@tribunal/github/sync';
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync';
import { getPrimaryWorkspaceIdForInstallation } from '$lib/server/github/webhooks/handlers';

/**
 * Fire-and-forget an installation sync, logging both thrown errors and
 * `status: 'error'` results so a failed enqueue is never silently dropped.
 *
 * KNOWN DURABILITY LIMITATION (surfaced by review; not fixed in this increment):
 * the webhook delivery is claimed upstream (`claimWebhookDelivery`) BEFORE this
 * handler runs, and this enqueue is fire-and-forget (webhooks must return well
 * inside GitHub's ~10s timeout — awaiting a repo-provisioning sync here would
 * regress latency once the workflow is real). So if the enqueue fails after the
 * delivery is claimed, a GitHub redelivery is deduped away and the sync is lost.
 * This is inert today (the `installation-sync` workflow is not ported, so the
 * producer is a no-op success), but BEFORE porting that workflow the enqueue must
 * become recoverable (an outbox row + reconciler, or claim-after-enqueue). See
 * documentation/WEFT_MIGRATION_PLAN.md.
 */
function fireAndForgetInstallationSync(
  options: EnqueueInstallationSyncOptions,
  logger: WebhookContext['logger'],
): void {
  void enqueueInstallationSync(githubContext, options)
    .then((result) => {
      if (result.status === 'error') {
        logger.error(
          { error: result.error, workflowId: result.workflowId },
          'Installation sync enqueue returned an error status',
        );
      }
    })
    .catch((error) => logger.error({ error }, 'Failed to enqueue installation sync'));
}

/**
 * Handle installation webhook events.
 * Non-orchestrator events - already claimed early in ingress, log errors without throwing.
 */
export async function handleInstallation(
  payload: InstallationEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, logger } = context;

  switch (action) {
    case 'deleted': {
      await handleInstallationDeleted(githubContext, installationId);
      logger.info('Installation deleted');
      break;
    }

    case 'suspend': {
      await handleInstallationSuspend(githubContext, installationId, 'Suspended by GitHub');
      logger.info('Installation suspended');
      break;
    }

    case 'unsuspend': {
      await handleInstallationUnsuspend(githubContext, installationId);
      logger.info('Installation unsuspended');
      break;
    }

    case 'created': {
      // Handle direct GitHub installs (bypassing our connect flow)
      // This creates a stub installation record so subsequent webhooks don't fail
      const account = payload.installation.account;
      if (account) {
        await upsertInstallation(githubContext, {
          installationId,
          accountLogin: account.login,
          accountType: account.type as 'User' | 'Organization',
          accountId: account.id,
          accountAvatarUrl: account.avatar_url ?? null,
          repositorySelection: payload.installation.repository_selection as 'all' | 'selected',
        });

        // Trigger sync to fetch repositories (fire-and-forget — see
        // fireAndForgetInstallationSync for the durability limitation).
        // TODO(weft): thread the webhook delivery GUID from +server.ts down to here
        // and pass it as `deliveryId` so retries dedup at the Weft signal layer too
        // (GitHub redeliveries are already deduped upstream by claimWebhookDelivery).
        const workspaceId = await getPrimaryWorkspaceIdForInstallation(installationId);
        fireAndForgetInstallationSync(
          { installationId, reason: 'webhook:installation.created', workspaceId },
          logger,
        );

        logger.info(
          `Installation ${installationId} created for ${account.login} (direct install or callback race)`,
        );
      } else {
        logger.info(`Installation ${installationId} created but no account info available`);
      }
      break;
    }

    case 'new_permissions_accepted': {
      await updateInstallationStatus(githubContext, installationId, 'active');

      // Trigger sync in case new permissions grant access to more repos
      // (fire-and-forget — see fireAndForgetInstallationSync for the limitation).
      const workspaceId = await getPrimaryWorkspaceIdForInstallation(installationId);
      fireAndForgetInstallationSync(
        { installationId, reason: 'webhook:installation.new_permissions_accepted', workspaceId },
        logger,
      );

      logger.info(`Installation ${installationId} new permissions accepted`);
      break;
    }

    default:
      logger.debug({ action }, 'Unhandled installation action');
  }
}
