/**
 * Check run webhook event handler.
 * Handles: check_run.completed
 */

import type { CheckRunEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { dispatchCheckCompletedSignals } from './check-completed-dispatch.server';

/**
 * Handle check_run webhook events.
 * Check runs can reference multiple PRs; signal all of them.
 * Orchestrator-trigger actions throw on dispatch failure for 500 retry.
 * Claiming is performed at the +server.ts level for all orchestrator events.
 */
export async function handleCheckRun(
  payload: CheckRunEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  if (action !== 'completed') {
    logger.debug({ action }, 'Ignoring non-completed check_run action');
    return;
  }

  await dispatchCheckCompletedSignals(
    {
      eventLabel: 'check_run',
      prNumbers: payload.check_run.pull_requests?.map((pr) => pr.number) ?? [],
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      actorLogin: payload.sender?.login,
    },
    context,
  );
}
