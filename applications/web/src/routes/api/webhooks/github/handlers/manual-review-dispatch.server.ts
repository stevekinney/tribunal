/**
 * Shared manual re-run dispatch for check_run.rerequested,
 * check_run.requested_action (identifier `re-review`), and
 * check_suite.rerequested. Enqueues a `manual`-trigger review_intent for every
 * PR associated with the check run/suite.
 */

import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { signalManualReview } from '@tribunal/github/pull-requests/state/workflow-signals';
import {
  hasDurableReviewIntentForDrain,
  kickReviewEngineAfterDurableIntentCount,
} from './review-engine-kick.server';

export interface ManualReviewDispatchOptions {
  /** Human-readable event label used in log messages. */
  eventLabel: string;
  /** PR numbers extracted from the event payload's associated pull requests list. */
  prNumbers: number[];
  owner: string;
  repo: string;
  /** Head SHA the manual re-run targets. */
  headSha: string;
  actorLogin: string | undefined;
  /** The triggering Check Run's own id, reused instead of creating a new one. */
  checkRunId?: number;
}

/**
 * Dispatch manual review intents for all PRs associated with a re-run
 * trigger. Throws if enqueue fails, so the outer handler can return a 500 for
 * GitHub to retry — matching the durable-enqueue contract of the other
 * review-engine trigger handlers.
 */
export async function dispatchManualReviewSignal(
  options: ManualReviewDispatchOptions,
  context: WebhookContext,
): Promise<void> {
  const { eventLabel, prNumbers, owner, repo, headSha, actorLogin, checkRunId } = options;
  const { repositoryId, logger } = context;

  if (prNumbers.length === 0) {
    logger.debug(`${eventLabel} has no associated PRs`);
    return;
  }

  const results = await Promise.all(
    prNumbers.map((prNumber) =>
      signalManualReview(githubContext, {
        repositoryId,
        prNumber,
        headSha,
        actorLogin,
        // GitHub delivery GUID -> Weft signalId for retry dedup, matching the
        // idempotency pattern of the other review-engine trigger handlers.
        eventId: context.deliveryId,
        checkRunId,
      }),
    ),
  );

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const details = failures.map((f) => `${f.workflowId}: ${f.error}`).join(', ');
    throw new Error(`Failed to signal ${eventLabel} for ${failures.length} PR(s): ${details}`);
  }

  const enqueuedCount = results.filter((result) => result.enqueued).length;
  const durableIntentCount = results.filter(hasDurableReviewIntentForDrain).length;
  if (durableIntentCount === 0) {
    logger.debug(`${eventLabel} did not map to durable review intents`, { owner, repo });
    return;
  }

  logger.info(
    `${eventLabel} manual review intents ready for ${durableIntentCount} PR(s); ${enqueuedCount} newly enqueued`,
  );
  await kickReviewEngineAfterDurableIntentCount(durableIntentCount, logger);
}
