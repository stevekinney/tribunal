/**
 * Shared check_run.completed and check_suite.completed review-engine hook.
 * Today these events are observed but do not persist review_intent rows until
 * the engine owns an explicit check-completed intent kind.
 */

import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { signalPullRequestEvent } from '@tribunal/github/pull-requests/state/workflow-signals';

/**
 * Parameters for observing check-completed review-engine signals.
 */
export interface CheckCompletedDispatchOptions {
  /** Human-readable event label used in log messages (e.g. "check_run" or "check_suite"). */
  eventLabel: string;
  /** PR numbers extracted from the event payload's associated pull requests list. */
  prNumbers: number[];
  /** Repository owner login. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Actor login for the signal (sender). */
  actorLogin: string | undefined;
}

/**
 * Observe check-completed events for all PRs associated with a completed check
 * run or suite. Throws if an implemented durable mapping fails, so the outer
 * handler can return a 500 for GitHub to retry.
 */
export async function dispatchCheckCompletedSignals(
  options: CheckCompletedDispatchOptions,
  context: WebhookContext,
): Promise<void> {
  const { eventLabel, prNumbers, owner, repo, actorLogin } = options;
  const { installationId, repositoryId, logger } = context;

  if (prNumbers.length === 0) {
    logger.debug(`${eventLabel} has no associated PRs`);
    return;
  }

  const results = await Promise.all(
    prNumbers.map((prNumber) =>
      signalPullRequestEvent(githubContext, {
        repositoryId,
        prNumber,
        installationId,
        owner,
        repo,
        eventType: 'check_completed',
        actorLogin,
        // GitHub delivery GUID -> Weft signalId for retry dedup. One delivery can
        // fan out to several PRs, but each targets a distinct orchestrator
        // workflow id, so the shared GUID cannot collide across PRs.
        eventId: context.deliveryId,
      }),
    ),
  );

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const details = failures.map((f) => `${f.workflowId}: ${f.error}`).join(', ');
    throw new Error(
      `Failed to signal ${eventLabel}.completed for ${failures.length} PR(s): ${details}`,
    );
  }

  const enqueuedCount = results.filter((result) => result.enqueued).length;
  if (enqueuedCount === 0) {
    logger.debug(`${eventLabel} completed did not map to durable review intents`);
    return;
  }

  logger.info(`${eventLabel} completed review intents enqueued for ${enqueuedCount} PR(s)`);
}
