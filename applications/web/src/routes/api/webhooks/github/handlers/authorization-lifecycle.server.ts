/**
 * GitHub app authorization webhook event handler.
 * Handles: github_app_authorization.revoked
 *
 * Adapted from existing handlers in applications/web/src/lib/server/github/webhooks/handlers/authorization.ts
 */

import type { GithubAppAuthorizationEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import {
  invalidateGitHubAccessCache,
  markGitHubTokensInvalidByProviderUserId,
} from '$lib/server/github/access';

/**
 * Handle github_app_authorization webhook events.
 * Non-orchestrator events - already claimed early in ingress, log errors without throwing.
 */
export async function handleAuthorization(
  payload: GithubAppAuthorizationEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  switch (action) {
    case 'revoked': {
      // User revoked app authorization - invalidate their tokens
      const affectedUserIds = await markGitHubTokensInvalidByProviderUserId(payload.sender.id);

      // Clear access cache for all affected users in parallel
      // Use allSettled to ensure cache failures don't fail the webhook
      const results = await Promise.allSettled(
        affectedUserIds.map((userId) => invalidateGitHubAccessCache(userId)),
      );

      // Log any cache invalidation failures
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logger.error(
            { userId: affectedUserIds[i], error: result.reason },
            'Failed to invalidate access cache for user',
          );
        }
      }

      logger.info(
        `GitHub app authorization revoked by ${payload.sender.login} (ID: ${payload.sender.id}), ` +
          `invalidated tokens for ${affectedUserIds.length} user(s)`,
      );
      break;
    }

    default:
      logger.debug({ action }, 'Unhandled github_app_authorization action');
  }
}
