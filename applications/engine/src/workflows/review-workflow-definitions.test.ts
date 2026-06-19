import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestEngine, yieldToPortableEventLoop } from '@lostgradient/weft/testing';
import { createReviewWorkflowDefinitions } from './review-workflow-definitions';
import type { ClaimedReviewIntent, ReviewWorkflowEngine } from './review-workflow';

type TestEngineInstance = InstanceType<typeof TestEngine>;

let engine: TestEngineInstance | undefined;

afterEach(async () => {
  await engine?.[Symbol.asyncDispose]?.();
  engine = undefined;
});

describe('review workflow definitions with Weft TestEngine', () => {
  it('dispatches review lifecycle inputs through durable workflow starts', async () => {
    const processedIntents: ClaimedReviewIntent[] = [];
    const reviewWorkflowEngine = createFakeReviewWorkflowEngine({
      processClaimedReviewIntent: async (intent) => {
        processedIntents.push(intent);
      },
    });
    const testEngine = createEngine(reviewWorkflowEngine);

    const openIntent = createIntent('delivery-open', 'start', 'opened', 'open-sha');
    const synchronizedIntent = createIntent(
      'delivery-synchronize',
      'commit_pushed',
      'synchronize',
      'sync-sha',
    );
    const duplicateIntent = createIntent('delivery-open', 'start', 'opened', 'open-sha');
    const closeIntent = { ...createIntent('delivery-close', 'pr_closed', 'manual', 'sync-sha') };

    await runWorkflow(testEngine, 'review-pr-open', openIntent);
    await runWorkflow(testEngine, 'review-pr-synchronize', synchronizedIntent);
    await runWorkflow(testEngine, 'review-pr-duplicate', duplicateIntent);
    await runWorkflow(testEngine, 'review-pr-close', closeIntent);

    expect(processedIntents.map((intent) => intent.kind)).toEqual([
      'start',
      'commit_pushed',
      'start',
      'pr_closed',
    ]);
    expect(processedIntents.map((intent) => intent.deliveryId)).toEqual([
      'delivery-open',
      'delivery-synchronize',
      'delivery-open',
      'delivery-close',
    ]);
  });

  it('routes stop recording, singleton reaper, and crash-resume inputs through TestEngine', async () => {
    const processedIntents: ClaimedReviewIntent[] = [];
    const reapedSandboxes: Array<{ repositoryId: number; pullRequestNumber: number }> = [];
    const reviewWorkflowEngine = createFakeReviewWorkflowEngine({
      processClaimedReviewIntent: async (intent) => {
        processedIntents.push(intent);
      },
      reapClosedPullRequestSandboxes: async (openPullRequests) => {
        reapedSandboxes.push(...openPullRequests);
      },
    });
    const testEngine = createEngine(reviewWorkflowEngine);

    await runWorkflow(
      testEngine,
      'review-pr-crash-resume',
      createIntent('delivery-resume', 'start', 'opened', 'resume-sha'),
    );
    await runWorkflow(
      testEngine,
      'review-run-stop-recording',
      createIntent('delivery-stop-recording', 'pr_closed', 'manual', 'resume-sha'),
      'review-run',
    );
    await runReaper(testEngine, [{ repositoryId: 42, pullRequestNumber: 7 }]);

    expect(processedIntents.map((intent) => intent.deliveryId)).toEqual([
      'delivery-resume',
      'delivery-stop-recording',
    ]);
    expect(reapedSandboxes).toEqual([{ repositoryId: 42, pullRequestNumber: 7 }]);
  });
});

function createEngine(reviewWorkflowEngine: ReviewWorkflowEngine): TestEngineInstance {
  const testEngine = new TestEngine();
  testEngine.registerWorkflows(createReviewWorkflowDefinitions(reviewWorkflowEngine));
  engine = testEngine;
  return testEngine;
}

async function runWorkflow(
  testEngine: TestEngineInstance,
  id: string,
  intent: ClaimedReviewIntent,
  workflowName: 'review-pr' | 'review-run' = 'review-pr',
) {
  const handle = await testEngine.start(workflowName, intent, { id });
  await yieldToPortableEventLoop();
  const state = await awaitTerminal(testEngine, handle.id);
  expect(state.status).toBe('completed');
}

async function runReaper(
  testEngine: TestEngineInstance,
  openPullRequests: Array<{ repositoryId: number; pullRequestNumber: number }>,
) {
  const handle = await testEngine.start('sandbox-reaper', openPullRequests, {
    id: 'sandbox-reaper-singleton',
  });
  await yieldToPortableEventLoop();
  const state = await awaitTerminal(testEngine, handle.id);
  expect(state.status).toBe('completed');
}

async function awaitTerminal(testEngine: TestEngineInstance, id: string) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const state = await testEngine.get(id);
    if (state && ['completed', 'failed', 'cancelled', 'timed-out'].includes(state.status)) {
      return state;
    }
    await yieldToPortableEventLoop();
  }

  const finalState = await testEngine.get(id);
  const status = finalState?.status ?? 'missing';
  throw new Error(
    `Workflow ${id} did not reach a terminal state after 5 attempts; status: ${status}.`,
  );
}

function createIntent(
  deliveryId: string,
  kind: ClaimedReviewIntent['kind'],
  trigger: ClaimedReviewIntent['pullRequest']['trigger'],
  headSha: string,
): ClaimedReviewIntent {
  return {
    id: `intent-${deliveryId}`,
    deliveryId,
    kind,
    pullRequest: {
      userId: 1,
      repositoryId: 42,
      installationId: 1001,
      repository: { owner: 'lostgradient', name: 'tribunal' },
      pullRequestNumber: 7,
      headSha,
      trigger,
      agents: [],
      dailyCostCapUsd: 25,
      ignoreGlobs: [],
    },
    prState: kind === 'pr_closed' ? 'closed' : undefined,
    createdAt: new Date('2026-06-19T12:00:00.000Z'),
    claimedAt: new Date('2026-06-19T12:00:01.000Z'),
  };
}

function createFakeReviewWorkflowEngine(
  overrides: {
    processClaimedReviewIntent?: (intent: ClaimedReviewIntent) => Promise<void>;
    reapClosedPullRequestSandboxes?: (
      openPullRequests: Array<{ repositoryId: number; pullRequestNumber: number }>,
    ) => Promise<void>;
  } = {},
): ReviewWorkflowEngine {
  return {
    processClaimedReviewIntent: overrides.processClaimedReviewIntent ?? vi.fn(),
    reapClosedPullRequestSandboxes: overrides.reapClosedPullRequestSandboxes ?? vi.fn(),
  } as unknown as ReviewWorkflowEngine;
}
