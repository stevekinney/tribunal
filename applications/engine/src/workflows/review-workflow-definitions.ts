import { workflow } from '@lostgradient/weft';
import type { ClaimedReviewIntent, ReviewWorkflowEngine } from './review-workflow';

const reviewRunWorkflow = workflow({ name: 'review-run' }).execute(async function* () {
  return { registered: true };
});

const agentReviewWorkflow = workflow({ name: 'agent-review' }).execute(async function* () {
  return { registered: true };
});

const sandboxReaperWorkflow = workflow({ name: 'sandbox-reaper' }).execute(async function* () {
  return { registered: true };
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

  return {
    'review-pr': reviewPullRequestWorkflow,
    'review-run': reviewRunWorkflow,
    'agent-review': agentReviewWorkflow,
    'sandbox-reaper': sandboxReaperWorkflow,
  };
}
