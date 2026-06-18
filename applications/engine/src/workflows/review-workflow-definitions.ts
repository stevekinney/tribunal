import { workflow } from '@lostgradient/weft';
import type { ClaimedReviewIntent, ReviewWorkflowEngine } from './review-workflow';

type OpenPullRequestSandbox = { repositoryId: number; pullRequestNumber: number };

export function createReviewWorkflowDefinitions(reviewWorkflowEngine: ReviewWorkflowEngine) {
  const reviewActivities = {
    processReviewIntent: async (intent: ClaimedReviewIntent) => {
      await reviewWorkflowEngine.processClaimedReviewIntent(intent);
      return { processed: true };
    },
  };
  const reviewPullRequestWorkflow = workflow({ name: 'review-pr' })
    .activities({
      processReviewIntent: reviewActivities.processReviewIntent,
    })
    .execute(async function* (ctx, intent: ClaimedReviewIntent) {
      return yield* ctx.run('processReviewIntent', intent);
    });
  const reviewRunWorkflow = workflow({ name: 'review-run' })
    .activities({
      processReviewIntent: reviewActivities.processReviewIntent,
    })
    .execute(async function* (ctx, intent: ClaimedReviewIntent) {
      return yield* ctx.run('processReviewIntent', intent);
    });
  const agentReviewWorkflow = workflow({ name: 'agent-review' })
    .activities({
      processReviewIntent: reviewActivities.processReviewIntent,
    })
    .execute(async function* (ctx, intent: ClaimedReviewIntent) {
      return yield* ctx.run('processReviewIntent', intent);
    });
  const sandboxReaperWorkflow = workflow({ name: 'sandbox-reaper' })
    .activities({
      reapClosedPullRequestSandboxes: async (openPullRequests: OpenPullRequestSandbox[]) => {
        await reviewWorkflowEngine.reapClosedPullRequestSandboxes(openPullRequests);
        return { reaped: true };
      },
    })
    .execute(async function* (ctx, openPullRequests: OpenPullRequestSandbox[] = []) {
      return yield* ctx.run('reapClosedPullRequestSandboxes', openPullRequests);
    });

  return {
    'review-pr': reviewPullRequestWorkflow,
    'review-run': reviewRunWorkflow,
    'agent-review': agentReviewWorkflow,
    'sandbox-reaper': sandboxReaperWorkflow,
  };
}
