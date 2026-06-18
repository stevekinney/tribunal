import { workflow } from '@lostgradient/weft';
import type { ClaimedReviewIntent, ReviewWorkflowEngine } from './review-workflow';

type OpenPullRequestSandbox = { repositoryId: number; pullRequestNumber: number };

const reviewRunWorkflow = workflow({ name: 'review-run' }).execute(async function* () {
  yield* [];
  throw new Error('review-run is executed through the review-pr supervisor workflow.');
});

const agentReviewWorkflow = workflow({ name: 'agent-review' }).execute(async function* () {
  yield* [];
  throw new Error('agent-review is executed through the review-pr supervisor workflow.');
});

export function createReviewWorkflowDefinitions(reviewWorkflowEngine: ReviewWorkflowEngine) {
  const reviewPullRequestWorkflow = workflow({ name: 'review-pr' })
    .activities({
      processReviewIntent: async (intent: ClaimedReviewIntent) => {
        await reviewWorkflowEngine.processClaimedReviewIntent(intent);
        return { processed: true };
      },
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
