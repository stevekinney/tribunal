/**
 * Push webhook event handler.
 * Handles: push events (for base branch updates)
 *
 * Adapted from existing dispatchBaseBranchUpdate logic.
 */

import type { PushEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { dispatchBaseBranchUpdate } from '@tribunal/github/webhooks/pr-state-dispatch';

/**
 * Handle push webhook events.
 * Non-orchestrator events - already claimed early in ingress, log errors without throwing.
 */
export async function handlePush(payload: PushEvent, context: WebhookContext): Promise<void> {
  const { logger } = context;

  // Dispatch base branch update (fire-and-forget)
  void dispatchBaseBranchUpdate(githubContext, payload).catch((e) =>
    logger.error({ error: e }, 'Base branch push handler failed'),
  );

  logger.debug('Push event processed');
}
