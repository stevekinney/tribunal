import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  AgentResult,
  AgentSpec,
  CheckRunPatch,
  CostPort,
  DailyCapDecision,
  DiffContext,
  GitHubPort,
  LlmEstimateInput,
  RepoRef,
  ReviewPayload,
  SandboxCostInput,
  SandboxAgentExecutionOptions,
  SandboxOptions,
  SandboxPort,
  ScopedToken,
} from '@tribunal/review-core';
import { verifyCapabilityToken } from '@tribunal/review-core/capability-token';
import {
  ReviewWorkflowEngine,
  type AgentRunRecord,
  type ClaimedReviewIntent,
  type FindingRecord,
  type PullRequestReviewInput,
  type ReviewIntent,
  type ReviewIntentPort,
  type ReviewRunRecord,
  type ReviewWorkflowStatePort,
  type DurableReviewWorkflowState,
} from './review-workflow';

const repository = { owner: 'lostgradient', name: 'tribunal' };

const reviewAgent: AgentSpec = {
  id: 'agent_security',
  userId: 1,
  slug: 'security-review',
  description: 'Looks for risky changes.',
  body: 'Review the pull request for security issues.',
  model: 'sonnet',
  effort: 'medium',
  enabled: true,
};

const performanceAgent: AgentSpec = {
  ...reviewAgent,
  id: 'agent_performance',
  slug: 'performance-review',
  description: 'Looks for performance issues.',
};

const baseInput: PullRequestReviewInput = {
  userId: 1,
  repositoryId: 42,
  installationId: 1001,
  repository,
  pullRequestNumber: 7,
  headSha: 'aaa111',
  trigger: 'opened',
  agents: [reviewAgent],
  ignoreGlobs: [],
};

describe('ReviewWorkflowEngine', () => {
  it('claims review_intent rows and starts one supervisor for duplicate start intents', async () => {
    const ports = createFakePorts();
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    ports.intents.enqueue(createIntent('intent_2', 'delivery_2', 'start', baseInput));
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents()).resolves.toBe(2);

    const snapshot = engine.snapshot();
    expect(snapshot.supervisors).toHaveLength(1);
    expect(snapshot.supervisors[0]?.workflowId).toBe('review:pr:42:7');
    expect(snapshot.reviewRuns.filter((run) => run.status === 'posted')).toHaveLength(1);
    expect(ports.sandbox.ensureCalls).toHaveLength(1);
    expect(ports.sandbox.ensureCalls[0]?.options.idleSuspendSeconds).toBe(900);
    expect(ports.intents.processedIntentIds).toEqual(['intent_1', 'intent_2']);
  });

  it('processes commit and close intents through the claim loop with a processing limit', async () => {
    const ports = createFakePorts();
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    ports.intents.enqueue(
      createIntent('intent_2', 'delivery_2', 'commit_pushed', {
        ...baseInput,
        headSha: 'bbb222',
        trigger: 'synchronize',
      }),
    );
    ports.intents.enqueue({
      ...createIntent('intent_3', 'delivery_3', 'pr_closed', baseInput),
      prState: 'merged',
    });
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents(2)).resolves.toBe(2);
    expect(ports.intents.processedIntentIds).toEqual(['intent_1', 'intent_2']);

    await expect(engine.claimReviewIntents()).resolves.toBe(1);
    expect(engine.snapshot().supervisors[0]).toMatchObject({ status: 'closed' });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'success' },
    });
  });

  it('stops in-flight agents, supersedes the stale run, and reuses the sandbox on commit_pushed', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const firstRun = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };
    const secondRun = engine.signalCommitPushed(updatedInput);
    ports.sandbox.resolveHeldAgents();

    await expect(firstRun).resolves.toMatchObject({ status: 'superseded' });
    await expect(secondRun).resolves.toMatchObject({ status: 'posted', headSha: 'bbb222' });

    const snapshot = engine.snapshot();
    expect(snapshot.reviewRuns.filter((run) => run.status !== 'superseded')).toHaveLength(1);
    expect(ports.sandbox.ensureCalls).toHaveLength(1);
    expect(ports.sandbox.stopCalls).toHaveLength(1);
    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual(['aaa111', 'bbb222']);
    expect(snapshot.agentRuns.some((agentRun) => agentRun.stoppedReason === 'superseded')).toBe(
      true,
    );
  });

  it('deduplicates concurrent first review starts for the same pull request', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);

    const firstRun = engine.startPullRequestReview(baseInput);
    const secondRun = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();
    ports.sandbox.resolveHeldAgents();

    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([
      expect.objectContaining({ id: 'run:42:7:aaa111:opened', status: 'posted' }),
      expect.objectContaining({ id: 'run:42:7:aaa111:opened', status: 'posted' }),
    ]);
    expect(ports.sandbox.ensureCalls).toHaveLength(1);
    expect(ports.github.createdCheckRuns).toEqual(['aaa111']);
  });

  it('persists review and agent run state as the review progresses', async () => {
    const ports = createFakePorts({ endLineOnlyFinding: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });

    expect(ports.state.reviewRuns.map((run) => [run.id, run.status])).toEqual([
      ['run:42:7:aaa111:opened', 'posted'],
    ]);
    expect(ports.state.agentRuns.map((run) => [run.id, run.status, run.userId])).toEqual([
      ['arun:run:42:7:aaa111:opened:agent_security', 'succeeded', 1],
    ]);
    expect(ports.state.agentRuns[0]).toMatchObject({
      findingsCount: 1,
      modelUsed: 'sonnet',
      durationMs: 25,
    });
    expect(ports.state.findings).toEqual([
      expect.objectContaining({
        agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
        path: 'src/example.ts',
        fingerprint: 'ee0a9dfa578eb57fdc06d62203ffc97bee9d115d12360e4caf0367deb5263dcd',
        anchored: true,
        startLine: null,
        endLine: 12,
      }),
    ]);
    expect(ports.state.agentEvents).toEqual([
      expect.objectContaining({
        agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
        seq: 1,
        kind: 'session_start',
      }),
    ]);
    expect(ports.cost.reconcileCalls).toEqual(['run:42:7:aaa111:opened']);
    expect(engine.snapshot().durableState.reconciledReviewRunIds).toEqual([
      'run:42:7:aaa111:opened',
    ]);
  });

  it('does not reconcile a run again after hydrating reconciled durable state', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports, {
      reconciledReviewRunIds: ['run:42:7:aaa111:opened'],
    });

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });

    expect(ports.cost.reconcileCalls).toEqual([]);
    expect(engine.snapshot().durableState.reconciledReviewRunIds).toEqual([
      'run:42:7:aaa111:opened',
    ]);
  });

  it('hydrates running review state and skips duplicate posts when durable state shows comments already posted', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:previous:opened',
      idempotencyKey: 'review:run:42:7:previous:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'previous',
      trigger: 'opened',
      status: 'posted',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0.01,
      startedAt: new Date('2026-06-17T11:58:00.000Z'),
      finishedAt: new Date('2026-06-17T11:59:00.000Z'),
    });
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:59:00.000Z'),
    });
    ports.state.seedAgentRun({
      id: 'arun:run:42:7:aaa111:opened:agent_security',
      idempotencyKey: 'agent:run:42:7:aaa111:opened:agent_security',
      reviewRunId: 'run:42:7:aaa111:opened',
      userId: 1,
      agentId: 'agent_security',
      status: 'running',
      findingsCount: 0,
      costEstimateUsd: 0,
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
    });

    expect(ports.sandbox.ensureCalls).toEqual([]);
    expect(ports.github.createdCheckRuns).toEqual([]);
    expect(ports.sandbox.updateCalls).toEqual([
      expect.objectContaining({ sandboxId: 'sandbox-existing', head: 'aaa111' }),
    ]);
    expect(ports.github.reviews).toEqual([]);
    expect(engine.snapshot().supervisors[0]).toMatchObject({
      sandboxId: 'sandbox-existing',
      activeRunId: undefined,
      reviewedHeadShas: ['previous', 'aaa111'],
    });
    expect(engine.snapshot().agentRuns).toEqual([
      expect.objectContaining({
        id: 'arun:run:42:7:aaa111:opened:agent_security',
        status: 'succeeded',
      }),
    ]);
  });

  it('hydrates reviewed head SHAs from durable runs in chronological order', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:newest:opened',
      idempotencyKey: 'review:run:42:7:newest:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'newest',
      trigger: 'opened',
      status: 'posted',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0.01,
      startedAt: new Date('2026-06-17T12:03:00.000Z'),
      finishedAt: new Date('2026-06-17T12:04:00.000Z'),
    });
    ports.state.seedReviewRun({
      id: 'run:42:7:oldest:opened',
      idempotencyKey: 'review:run:42:7:oldest:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'oldest',
      trigger: 'opened',
      status: 'posted',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0.01,
      startedAt: new Date('2026-06-17T12:01:00.000Z'),
      finishedAt: new Date('2026-06-17T12:02:00.000Z'),
    });
    ports.state.seedReviewRun({
      id: 'run:42:7:same-a:opened',
      idempotencyKey: 'review:run:42:7:same-a:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'same-a',
      trigger: 'opened',
      status: 'posted',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0.01,
      startedAt: new Date('2026-06-17T12:02:00.000Z'),
      finishedAt: new Date('2026-06-17T12:02:30.000Z'),
    });
    ports.state.seedReviewRun({
      id: 'run:42:7:same-b:opened',
      idempotencyKey: 'review:run:42:7:same-b:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'same-b',
      trigger: 'opened',
      status: 'posted',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0.01,
      startedAt: new Date('2026-06-17T12:02:00.000Z'),
      finishedAt: new Date('2026-06-17T12:02:45.000Z'),
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });

    expect(engine.snapshot().supervisors[0]?.reviewedHeadShas).toEqual([
      'oldest',
      'same-a',
      'same-b',
      'newest',
      'aaa111',
    ]);
  });

  it('hydrates running review state and retries review posts when durable state has no posted comments', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:59:00.000Z'),
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
      commentsPosted: 1,
    });

    expect(ports.github.reviews).toHaveLength(1);
    expect(ports.github.reviews[0]?.body).toContain(
      '<!-- tribunal-review-run:v1:run:42:7:aaa111:opened:',
    );
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
      commentsPosted: 1,
    });
  });

  it('does not repost reviews when retrying a failed durable run that already posted comments', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'failed',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 1,
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:59:00.000Z'),
      finishedAt: new Date('2026-06-17T12:00:00.000Z'),
      error: 'check update failed',
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
      commentsPosted: 1,
    });

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
      commentsPosted: 1,
    });
  });

  it('does not regress a posted run or check when the final check update fails', async () => {
    const ports = createFakePorts({ failCheckRunUpdatesRemaining: 1 });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'check run update failed',
    );

    expect(ports.github.reviews).toHaveLength(1);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
      commentsPosted: 1,
    });
    expect(ports.state.reviewRuns.at(-1)?.error).toBeUndefined();
    expect(ports.github.checkRunPatches).toEqual([]);
  });

  it('backs off without failing the run when another worker owns the review post claim', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T12:00:00.000Z'),
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:59:00.000Z'),
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'running',
      commentsPosted: 0,
    });
    expect(ports.github.checkRunPatches).toEqual([]);
  });

  it('backs off without failing when claimed review marker lookup is unavailable', async () => {
    const ports = createFakePorts({ failPostedReviewLookupsRemaining: 1 });
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T11:54:00.000Z'),
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:53:00.000Z'),
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'running',
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T11:54:00.000Z'),
    });
    expect(ports.github.checkRunPatches).toEqual([]);
  });

  it('reclaims a stale review post claim after confirming GitHub has no run marker', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T11:54:00.000Z'),
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:53:00.000Z'),
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 1,
    });

    expect(ports.github.reviews).toHaveLength(1);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      commentsPosted: 1,
      reviewPostClaimedAt: undefined,
    });
  });

  it('uses durable posted state when stale claim recovery races with a completed post', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T11:54:00.000Z'),
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:53:00.000Z'),
    });
    ports.state.reportAlreadyPostedAfterClear(4);
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 4,
    });

    expect(ports.github.reviews).toEqual([]);
  });

  it('backs off when stale claim recovery loses the reclaim race', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T11:54:00.000Z'),
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:53:00.000Z'),
    });
    ports.state.reportClaimedByOtherOnNextClaim();
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );

    expect(ports.github.reviews).toEqual([]);
  });

  it('fences review posting when claim ownership is lost before the GitHub write', async () => {
    const ports = createFakePorts();
    ports.state.failNextReviewPostOwnershipCheck();
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'running',
      commentsPosted: 0,
    });
  });

  it('fences review posting when claim ownership is lost during marker reconciliation', async () => {
    const ports = createFakePorts();
    ports.state.failReviewPostOwnershipCheckAfter(2);
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'running',
      commentsPosted: 0,
    });
  });

  it('fences review posting when claim ownership is lost during the pre-post refresh', async () => {
    const ports = createFakePorts();
    ports.state.failReviewPostClaimRefreshAfter(1);
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'running',
      commentsPosted: 0,
      reviewPostClaimedAt: undefined,
    });
  });

  it('clears the owned claim when marker reconciliation fails before posting', async () => {
    const ports = createFakePorts({ failPostedReviewLookupsRemaining: 1 });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'posted review lookup failed',
    );
    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'failed',
      commentsPosted: 0,
      reviewPostClaimedAt: undefined,
    });

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 1,
    });
    expect(ports.github.reviews).toHaveLength(1);
  });

  it('does not post when the signed marker appears after acquiring the claim', async () => {
    const ports = createFakePorts();
    ports.github.postedReviews.set(createExpectedReviewMarker('run:42:7:aaa111:opened'), 5);
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 5,
    });

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'posted',
      commentsPosted: 5,
      reviewPostClaimedAt: undefined,
    });
  });

  it('skips posting when the durable claim observes comments were already posted', async () => {
    const ports = createFakePorts();
    ports.state.reportAlreadyPostedOnNextClaim(3);
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 3,
    });

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
      commentsPosted: 3,
    });
  });

  it('keeps the review post claim after an attempted post fails with no GitHub-visible review', async () => {
    const ports = createFakePorts({ failReviewPostsRemaining: 1 });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow('review post failed');
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'failed',
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T12:00:00.000Z'),
    });

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Review post is already claimed',
    );
    expect(ports.github.reviews).toEqual([]);
  });

  it('records posted comments when a failed post is visible on GitHub by run marker', async () => {
    const ports = createFakePorts({
      failReviewPostsRemaining: 1,
      publishFailedReviewBeforeThrowing: true,
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 1,
    });

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      commentsPosted: 1,
      reviewPostClaimedAt: undefined,
    });
  });

  it('reconciles an already claimed review post when GitHub has the run marker', async () => {
    const ports = createFakePorts();
    ports.state.seedReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: 1,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      reviewPostClaimedAt: new Date('2026-06-17T12:00:00.000Z'),
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T11:59:00.000Z'),
    });
    ports.github.postedReviews.set(createExpectedReviewMarker('run:42:7:aaa111:opened'), 2);
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 2,
    });

    expect(ports.github.reviews).toEqual([]);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      commentsPosted: 2,
      reviewPostClaimedAt: undefined,
    });
  });

  it('returns the existing synchronize run when the same head is signaled twice', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };

    const firstSynchronizeRun = await engine.signalCommitPushed(updatedInput);
    const secondSynchronizeRun = await engine.signalCommitPushed(updatedInput);

    expect(secondSynchronizeRun).toBe(firstSynchronizeRun);
    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual(['aaa111', 'bbb222']);
  });

  it('waits for a duplicate running synchronize intent before marking it processed', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    ports.sandbox.holdFutureAgentRuns();
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };
    const runningSynchronize = engine.signalCommitPushed(updatedInput);
    await ports.sandbox.waitForRunningAgents(2);
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'commit_pushed', updatedInput));

    const duplicateDrain = engine.claimReviewIntents(1);
    await Promise.resolve();
    expect(ports.intents.processedIntentIds).toEqual([]);

    ports.sandbox.resolveHeldAgents();
    await runningSynchronize;
    await expect(duplicateDrain).resolves.toBe(1);
    expect(ports.intents.processedIntentIds).toEqual(['intent_1']);
    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual(['aaa111', 'bbb222']);
  });

  it('retries a same-head synchronize run after the previous attempt failed', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };

    ports.sandbox.failNextUpdate();
    await expect(engine.signalCommitPushed(updatedInput)).rejects.toThrow('sandbox update failed');
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      checkRunId: 9001,
      installationId: 1001,
      patch: {
        status: 'completed',
        conclusion: 'neutral',
        output: {
          title: 'Tribunal review failed',
          summary: 'Review run failed during setup. See Tribunal logs for details.',
        },
      },
    });
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'posted',
      headSha: 'bbb222',
    });

    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual([
      'aaa111',
      'bbb222',
      'bbb222',
    ]);
  });

  it('retries a same-head synchronize run after the previous attempt hit the cost cap', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };

    ports.cost.setSpendTodayEstimate(10);
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'quota_blocked',
      headSha: 'bbb222',
    });

    ports.cost.setSpendTodayEstimate(0);
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'posted',
      headSha: 'bbb222',
    });
  });

  it('stops an in-flight agent when the pull request closes', async () => {
    const ports = createFakePorts({ holdAllAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview({
      ...baseInput,
      agents: [performanceAgent, reviewAgent],
    });
    await ports.sandbox.waitForRunningAgent();

    await engine.signalPullRequestClosed(
      { ...baseInput, agents: [performanceAgent, reviewAgent] },
      'closed',
    );
    ports.sandbox.resolveHeldAgents();
    await runningReview;

    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_performance']);
  });

  it('terminates the sandbox and finalizes the check run when the pull request closes', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.signalPullRequestClosed(baseInput, 'closed');
    ports.sandbox.resolveHeldAgents();
    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });

    const snapshot = engine.snapshot();
    expect(snapshot.supervisors[0]).toMatchObject({ status: 'closed', activeRunId: undefined });
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-42-7']);
    expect(ports.sandbox.stopCalls).toHaveLength(1);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'cancelled' },
    });

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Cannot start a review for a closed pull request supervisor.',
    );
  });

  it('ignores close and stop signals when no matching active work exists', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.signalPullRequestClosed(baseInput, 'closed');
    await engine.stopAgent('missing-run', 'missing-agent', 'timeout');

    expect(engine.snapshot().supervisors).toEqual([]);
    expect(ports.sandbox.stopCalls).toEqual([]);
    expect(ports.sandbox.terminateCalls).toEqual([]);
  });

  it('blocks at the daily cost cap before starting agents', async () => {
    const ports = createFakePorts({ spendTodayEstimate: 10 });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'quota_blocked',
    });

    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.cost.enforceDailyCapCalls).toEqual([1]);
    expect(ports.cost.llmEstimateKeys).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('records one LLM estimate per agent run even when a retry reaches the cost boundary twice', async () => {
    const ports = createFakePorts({ duplicateCostRecordCalls: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.cost.recordLlmEstimateCalls).toHaveLength(2);
    expect(ports.cost.llmEstimateKeys).toEqual([
      'llm:arun:run:42:7:aaa111:opened:agent_security:estimate',
    ]);
  });

  it('records failed agent results and posts a neutral check run', async () => {
    const ports = createFakePorts({ failAgentRuns: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'failed',
      error: 'sandbox runner failed',
    });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('records partial failed agent cost when the sandbox exposes it before throwing', async () => {
    const ports = createFakePorts({
      failAgentRuns: true,
      failedAgentPartialCostEstimateUsd: 0.42,
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      costEstimateUsd: 0.42,
    });

    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'failed',
      costEstimateUsd: 0.42,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
    expect(ports.cost.llmEstimates[0]).toMatchObject({ amountUsd: 0.42 });
  });

  it('preserves zero-cost partial failed agent details from the sandbox', async () => {
    const ports = createFakePorts({
      failAgentRuns: true,
      failedAgentPartialCostEstimateUsd: 0,
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      costEstimateUsd: 0,
    });

    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'failed',
      costEstimateUsd: 0,
      durationMs: 25,
      modelUsed: 'sonnet',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });

  it('rejects empty-string partial failed agent cost from the sandbox', async () => {
    const ports = createFakePorts({
      failAgentRuns: true,
      failedAgentPartialCostEstimateUsd: '',
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      costEstimateUsd: 0,
    });

    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'failed',
      costEstimateUsd: 0,
      durationMs: 0,
      modelUsed: 'sonnet',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });

  it('sanitizes invalid partial failed agent duration from the sandbox', async () => {
    const ports = createFakePorts({
      failAgentRuns: true,
      failedAgentPartialCostEstimateUsd: 0.1,
      failedAgentPartialDurationMs: -1,
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      costEstimateUsd: 0.1,
    });

    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'failed',
      durationMs: 0,
    });
  });

  it('skips agent execution when every changed file matches repository ignore globs', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(
      engine.startPullRequestReview({
        ...baseInput,
        ignoreGlobs: ['src/**'],
      }),
    ).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
      costEstimateUsd: 0,
    });

    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.cost.recordLlmEstimateCalls).toHaveLength(0);
    expect(ports.github.reviews).toHaveLength(0);
    const completedCheckRunPatch = ports.github.checkRunPatches.at(-1);

    expect(completedCheckRunPatch).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review skipped',
          summary: 'Only ignored paths changed.',
        },
      },
    });
  });

  it('passes a signed scoped run token to sandbox operations', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    const runToken = ports.sandbox.updateCalls[0]?.runToken;
    expect(runToken).toBeDefined();
    expect(runToken).not.toContain('run-token:');
    const verification = verifyCapabilityToken(
      runToken!,
      'proxy-signing-key',
      new Date('2026-06-17T12:00:00.000Z'),
    );
    expect(verification).toEqual({
      ok: true,
      claims: expect.objectContaining({
        runId: 'run:42:7:aaa111:opened',
        repositoryId: 42,
        installationId: 1001,
        repositoryOwner: 'lostgradient',
        repositoryName: 'tribunal',
        permissions: ['github:read', 'anthropic:invoke'],
      }),
    });
    expect(ports.sandbox.runAgentCalls[0]?.runToken).toBe(runToken);
    expect(ports.github.mintReadTokenCalls).toEqual([]);
  });

  it('passes resolved model and effort to the sandbox and records effective effort', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [
        {
          ...baseInput.agents[0]!,
          model: 'sonnet',
          effort: 'xhigh',
        },
      ],
    });

    expect(ports.sandbox.runAgentCalls[0]).toMatchObject({
      model: 'sonnet',
      effort: 'high',
    });
    expect(ports.sandbox.runAgentCalls[0]?.diffContext.changedFiles[0]).toMatchObject({
      path: 'src/example.ts',
      commentableLines: expect.arrayContaining([{ side: 'RIGHT', line: 12 }]),
    });
    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      modelUsed: 'sonnet',
      effortUsed: 'high',
    });
  });

  it('records sandbox cost with a billing-window idempotency key', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.cost.sandboxCostEvents).toEqual([
      expect.objectContaining({
        idempotencyKey: 'sandbox:sandbox-tribunal-pr-42-7:2026-06-17T12',
        window: '2026-06-17T12',
      }),
    ]);
  });

  it('releases a claimed intent when downstream processing fails without aborting the drain loop', async () => {
    const ports = createFakePorts({ failCheckRunCreation: true });
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents()).resolves.toBe(0);

    expect(ports.intents.processedIntentIds).toEqual([]);
    expect(ports.intents.failedIntentErrors).toEqual([
      { intentId: 'intent_1', message: 'check run creation failed' },
    ]);
  });

  it('does not count or fail an intent when its processed claim is stale', async () => {
    const ports = createFakePorts({ processedIntentClaimMatches: false });
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents()).resolves.toBe(0);

    expect(ports.intents.processedIntentIds).toEqual([]);
    expect(ports.intents.failedIntentErrors).toEqual([]);
  });

  it('backs off without failing the intent when another worker owns the review post claim', async () => {
    const ports = createFakePorts();
    ports.state.failNextReviewPostOwnershipCheck();
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents()).resolves.toBe(0);

    expect(ports.intents.processedIntentIds).toEqual([]);
    expect(ports.intents.failedIntentErrors).toEqual([]);
  });

  it('continues claiming later intents after one claimed intent fails', async () => {
    const ports = createFakePorts({ failCheckRunCreationsRemaining: 1 });
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    ports.intents.enqueue(
      createIntent('intent_2', 'delivery_2', 'start', {
        ...baseInput,
        pullRequestNumber: 8,
      }),
    );
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents(2)).resolves.toBe(1);

    expect(ports.intents.failedIntentErrors).toEqual([
      { intentId: 'intent_1', message: 'check run creation failed' },
    ]);
    expect(ports.intents.processedIntentIds).toEqual(['intent_2']);
  });

  it('stops dispatching agents when the daily cap is reached mid-run', async () => {
    const ports = createFakePorts({ spendTodayEstimate: 9.99, spendAfterFirstEstimate: 10 });
    const engine = createEngine(ports);

    await expect(
      engine.startPullRequestReview({
        ...baseInput,
        agents: [reviewAgent, performanceAgent],
      }),
    ).resolves.toMatchObject({ status: 'quota_blocked' });

    expect(ports.sandbox.runAgentCalls.map((call) => call.agentId)).toEqual(['agent_security']);
    expect(ports.github.reviews).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('posts deterministic sorted comments for multiple findings', async () => {
    const ports = createFakePorts({ multipleFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(
      ports.github.reviews[0]?.comments.map(
        (comment) => `${comment.path}:${comment.side}:${comment.line}`,
      ),
    ).toEqual([
      'src/example.ts:LEFT:2',
      'src/example.ts:RIGHT:3',
      'src/example.ts:RIGHT:12',
      'src/second.ts:RIGHT:1',
    ]);
  });

  it('deduplicates byte-identical findings from different agents before posting', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [reviewAgent, performanceAgent],
    });

    expect(ports.sandbox.runAgentCalls.map((call) => call.agentId)).toEqual([
      'agent_security',
      'agent_performance',
    ]);
    expect(ports.github.reviews[0]?.comments).toHaveLength(1);
  });

  it('deduplicates matching findings from different agents in completed Check Run output', async () => {
    const ports = createFakePorts({ mixedAnchoredAndOffDiffFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [reviewAgent, performanceAgent],
    });

    const completedCheckRunPatch = ports.github.checkRunPatches.at(-1);
    const checkRunText = completedCheckRunPatch?.patch.output?.text ?? '';

    expect(ports.github.reviews[0]?.comments).toHaveLength(1);
    expect(completedCheckRunPatch?.patch.output?.annotations).toHaveLength(1);
    expect(
      completedCheckRunPatch?.patch.output?.annotations?.filter(
        (annotation) => annotation.title === '[security-review] Check this change',
      ),
    ).toHaveLength(1);
    expect(checkRunText.match(/File-level finding/gu)).toHaveLength(1);
    expect(checkRunText.match(/Off-diff line/gu)).toHaveLength(1);
    expect(checkRunText).not.toContain('performance-review');
  });

  it('uses the end line as the GitHub review anchor for multi-line findings', async () => {
    const ports = createFakePorts({ multiLineFinding: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.github.reviews[0]?.comments).toEqual([
      expect.objectContaining({
        path: 'src/example.ts',
        line: 12,
        startLine: 3,
        side: 'RIGHT',
        startSide: 'RIGHT',
      }),
    ]);
  });

  it('anchors end-line-only findings without emitting multi-line GitHub fields', async () => {
    const ports = createFakePorts({ endLineOnlyFinding: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.github.reviews[0]?.comments).toEqual([
      expect.objectContaining({
        path: 'src/example.ts',
        line: 12,
        startLine: undefined,
        side: 'RIGHT',
        startSide: undefined,
      }),
    ]);
  });

  it('surfaces off-diff-only findings in the completed Check Run without posting an empty review', async () => {
    const ports = createFakePorts({ fileLevelFinding: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(ports.github.reviews).toEqual([]);
    const completedCheckRunPatch = ports.github.checkRunPatches.at(-1);

    expect(completedCheckRunPatch).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review complete',
          summary: expect.stringContaining('security-review: completed; model sonnet'),
          text: expect.stringContaining(
            '- security-review: src/example.ts File-level finding: This cannot be anchored inline.',
          ),
          annotations: [],
        },
      },
    });
  });

  it('posts inline findings while surfacing only off-diff findings in Check Run text', async () => {
    const ports = createFakePorts({ mixedAnchoredAndOffDiffFindings: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 1,
    });

    expect(ports.github.reviews[0]).toMatchObject({
      comments: [
        expect.objectContaining({
          path: 'src/example.ts',
          line: 12,
          body: expect.stringContaining('Check this change'),
        }),
      ],
    });
    expect(ports.github.reviews[0]?.body).toContain('Unanchored findings:');
    expect(ports.github.reviews[0]?.body).toContain('File-level finding');
    const completedCheckRunPatch = ports.github.checkRunPatches.at(-1);
    const checkRunText = completedCheckRunPatch?.patch.output?.text;

    expect(checkRunText).toContain(
      '- security-review: src/example.ts File-level finding: This cannot be anchored inline.',
    );
    expect(checkRunText).toContain(
      '- security-review: src/example.ts Off-diff line: This line is not commentable in the diff.',
    );
    expect(checkRunText).not.toContain('Check this change');
    expect(completedCheckRunPatch?.patch.output?.annotations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startLine: 99,
          title: '[security-review] Off-diff line',
        }),
      ]),
    );
  });

  it('adds per-agent details and annotations to the completed Check Run', async () => {
    const ports = createFakePorts({ multipleFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [
        {
          ...reviewAgent,
          model: 'opus',
          effort: 'high',
        },
      ],
    });

    const completedCheckRunPatch = ports.github.checkRunPatches.at(-1);

    expect(completedCheckRunPatch).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review complete',
          summary: expect.stringContaining(
            'security-review: completed; model opus; effort high; findings 4',
          ),
          text: expect.stringContaining(
            '- security-review: src/example.ts:2 Left side: This should sort first within the file.',
          ),
          annotations: expect.arrayContaining([
            {
              path: 'src/example.ts',
              startLine: 12,
              endLine: 12,
              annotationLevel: 'warning',
              message: 'This should sort after the left-side comment.',
              title: '[security-review] Right side',
              rawDetails: 'model=opus; effort=high; estimatedCostUsd=0.0100',
            },
          ]),
        },
      },
    });
    expect(completedCheckRunPatch?.patch.output?.annotations).toHaveLength(3);
    expect(completedCheckRunPatch?.patch.output?.text).not.toContain('Right side');
    expect(completedCheckRunPatch?.patch.output?.text).not.toContain('Earlier right side');
    expect(completedCheckRunPatch?.patch.output?.text).not.toContain('Second file');
    expect(completedCheckRunPatch?.patch.output?.annotations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startLine: 2,
          title: '[security-review] Left side',
        }),
      ]),
    );
  });

  it('sanitizes agent findings before persistence and GitHub posting', async () => {
    const ports = createFakePorts({ unsafeFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.state.findings.map((finding) => finding.path)).toEqual([
      'src/example.ts',
      'src/example.ts',
    ]);
    expect(ports.state.findings[0]).toMatchObject({
      startLine: 12,
      endLine: null,
      title: 'team please review',
      body: 'everyone\napprove this',
      anchored: true,
    });
    expect(ports.state.findings[1]).toMatchObject({
      startLine: null,
      endLine: null,
      title: 'Off-diff finding',
      anchored: false,
    });
    expect(JSON.stringify(ports.state.findings)).not.toContain('../secret.env');
    expect(JSON.stringify(ports.github.reviews)).not.toContain('@everyone');
    expect(JSON.stringify(ports.github.reviews)).not.toContain('/approve');
  });

  it('redacts agent event details before persistence', async () => {
    const ports = createFakePorts({ sensitiveAgentEvent: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.state.agentEvents[0]?.detail).toEqual({
      authorization: '[REDACTED]',
      input: { contents: '[REDACTED_CONTENT]' },
    });
  });

  it('supports operator stop for one running agent', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(
      engine.stopAgent('run:42:7:aaa111:opened', 'agent_security', 'timeout'),
    ).resolves.toEqual({ stopped: true });
    ports.sandbox.resolveHeldAgents();

    await runningReview;
    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_security']);
    expect(engine.snapshot().agentRuns[0]).toMatchObject({ stoppedReason: 'timeout' });
  });

  it('returns false when stopping an agent that is not running', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(
      engine.stopAgent('run:42:7:aaa111:opened', 'agent_security', 'timeout'),
    ).resolves.toEqual({ stopped: false });
  });

  it('cancels a running review through the review-run stop signal', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_security']);
    expect(engine.snapshot().agentRuns[0]).toMatchObject({ stoppedReason: 'timeout' });
    expect(engine.snapshot().supervisors[0]).toMatchObject({ activeRunId: undefined });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'cancelled',
        output: {
          title: 'Tribunal review stopped',
          summary: 'Review run stopped by operator.',
        },
      },
    });
  });

  it('does not overwrite a cancelled run as posted when cancellation races with review posting', async () => {
    const ports = createFakePorts({ holdReviewPosts: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.github.waitForReviewPost();

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.github.resolveHeldReviewPosts();

    await expect(runningReview).resolves.toMatchObject({
      status: 'cancelled',
      commentsPosted: 1,
    });
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'cancelled',
      commentsPosted: 1,
    });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'cancelled' },
    });
  });

  it('ignores review-run stop signals when no active run matches', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(engine.stopRun('missing-run', 'timeout')).resolves.toEqual({ stopped: false });

    expect(ports.sandbox.stopCalls).toEqual([]);
    expect(ports.github.checkRunPatches).toEqual([]);
  });

  it('does not cancel a finished review run from a late stop signal', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });
    const patchCount = ports.github.checkRunPatches.length;

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: false,
    });

    expect(ports.github.checkRunPatches).toHaveLength(patchCount);
    expect(ports.sandbox.stopCalls).toEqual([]);
  });

  it('clears a corrupted active run pointer without cancelling a finished check run', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);
    const supervisor = (
      engine as unknown as {
        supervisors: Map<string, { activeRunId?: string }>;
      }
    ).supervisors.get('review:pr:42:7');
    expect(supervisor).toBeDefined();
    supervisor!.activeRunId = 'run:42:7:aaa111:opened';
    const patchCount = ports.github.checkRunPatches.length;

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: false,
    });

    expect(engine.snapshot().supervisors[0]).toMatchObject({ activeRunId: undefined });
    expect(ports.github.checkRunPatches).toHaveLength(patchCount);
  });

  it('records a killed agent as cancelled when the sandbox runner throws after abort', async () => {
    const ports = createFakePorts({ holdAgentRuns: true, failAbortedAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.stopAgent('run:42:7:aaa111:opened', 'agent_security', 'timeout');
    ports.sandbox.resolveHeldAgents();

    await runningReview;
    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'cancelled',
      stoppedReason: 'timeout',
      error: undefined,
    });
  });

  it('records partial stopped agent cost when the sandbox exposes it after abort', async () => {
    const ports = createFakePorts({
      holdAgentRuns: true,
      failAbortedAgentRuns: true,
      failedAgentPartialCostEstimateUsd: 0.21,
    });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.stopAgent('run:42:7:aaa111:opened', 'agent_security', 'timeout');
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ costEstimateUsd: 0.21 });
    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'cancelled',
      stoppedReason: 'timeout',
      costEstimateUsd: 0.21,
    });
    expect(ports.cost.llmEstimates[0]).toMatchObject({ amountUsd: 0.21 });
  });

  it('reaps closed pull request sandboxes and leaves open pull request sandboxes alone', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview({
      ...baseInput,
      repositoryId: 43,
      pullRequestNumber: 8,
      headSha: 'ccc333',
    });
    await engine.startPullRequestReview(baseInput);

    expect(engine.snapshot().supervisors.map((supervisor) => supervisor.workflowId)).toEqual([
      'review:pr:42:7',
      'review:pr:43:8',
    ]);

    await expect(
      engine.reapClosedPullRequestSandboxes([{ repositoryId: 42, pullRequestNumber: 7 }]),
    ).resolves.toEqual(['sandbox-tribunal-pr-43-8']);
    await expect(
      engine.reapClosedPullRequestSandboxes([{ repositoryId: 42, pullRequestNumber: 7 }]),
    ).resolves.toEqual([]);
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-43-8']);
  });
});

function createEngine(
  ports: FakePorts,
  durableState: DurableReviewWorkflowState = {},
): ReviewWorkflowEngine {
  return new ReviewWorkflowEngine(
    ports,
    {
      sandboxImage: 'tribunal-reviewer:test',
      proxyUrl: 'https://proxy.example.test',
      proxySigningKey: 'proxy-signing-key',
      runTokenTtlSeconds: 60 * 60,
      idleSuspendSeconds: 900,
      defaultModel: 'sonnet',
    },
    () => new Date('2026-06-17T12:00:00.000Z'),
    durableState,
  );
}

function createExpectedReviewMarker(reviewRunId: string): string {
  const signature = createHmac('sha256', 'proxy-signing-key')
    .update(reviewRunId)
    .digest('base64url');
  return `<!-- tribunal-review-run:v1:${reviewRunId}:${signature} -->`;
}

function createIntent(
  id: string,
  deliveryId: string,
  kind: ReviewIntent['kind'],
  pullRequest: PullRequestReviewInput,
): ReviewIntent {
  return {
    id,
    deliveryId,
    kind,
    pullRequest,
    createdAt: new Date('2026-06-17T12:00:00.000Z'),
  };
}

type FakePorts = {
  github: FakeGitHubPort;
  sandbox: FakeSandboxPort;
  cost: FakeCostPort;
  intents: FakeReviewIntentPort;
  state: FakeReviewWorkflowStatePort;
};

function createFakePorts(options: FakePortOptions = {}): FakePorts {
  return {
    github: new FakeGitHubPort(options),
    sandbox: new FakeSandboxPort(options),
    cost: new FakeCostPort(options),
    intents: new FakeReviewIntentPort(options),
    state: new FakeReviewWorkflowStatePort(),
  };
}

type FakePortOptions = {
  holdAgentRuns?: boolean;
  holdAllAgentRuns?: boolean;
  spendTodayEstimate?: number;
  duplicateCostRecordCalls?: boolean;
  failAgentRuns?: boolean;
  failCheckRunCreation?: boolean;
  failCheckRunCreationsRemaining?: number;
  failCheckRunUpdatesRemaining?: number;
  failAbortedAgentRuns?: boolean;
  failNextSandboxUpdate?: boolean;
  failReviewPostsRemaining?: number;
  failPostedReviewLookupsRemaining?: number;
  publishFailedReviewBeforeThrowing?: boolean;
  multipleFindings?: boolean;
  multiLineFinding?: boolean;
  fileLevelFinding?: boolean;
  mixedAnchoredAndOffDiffFindings?: boolean;
  endLineOnlyFinding?: boolean;
  unsafeFindings?: boolean;
  sensitiveAgentEvent?: boolean;
  processedIntentClaimMatches?: boolean;
  spendAfterFirstEstimate?: number;
  holdReviewPosts?: boolean;
  failedAgentPartialCostEstimateUsd?: number | string;
  failedAgentPartialDurationMs?: number;
};

class FakeReviewIntentPort implements ReviewIntentPort {
  private readonly intents: ReviewIntent[] = [];
  readonly processedIntentIds: string[] = [];
  readonly failedIntentErrors: Array<{ intentId: string; message: string }> = [];

  constructor(private readonly options: FakePortOptions = {}) {}

  enqueue(intent: ReviewIntent): void {
    this.intents.push(intent);
  }

  async claimNextReviewIntent(now: Date): Promise<ClaimedReviewIntent | null> {
    const intent = this.intents.shift();
    return intent === undefined ? null : { ...intent, claimedAt: now };
  }

  async markReviewIntentProcessed(
    intentId: string,
    _claimedAt: Date,
    _now: Date,
  ): Promise<boolean> {
    if (this.options.processedIntentClaimMatches === false) return false;
    this.processedIntentIds.push(intentId);
    return true;
  }

  async markReviewIntentFailed(
    intentId: string,
    _claimedAt: Date,
    _now: Date,
    error: unknown,
  ): Promise<void> {
    this.failedIntentErrors.push({
      intentId,
      message: error instanceof Error ? error.message : 'Review intent processing failed.',
    });
  }
}

class FakeReviewWorkflowStatePort implements ReviewWorkflowStatePort {
  readonly reviewRuns: ReviewRunRecord[] = [];
  readonly agentRuns: AgentRunRecord[] = [];
  readonly agentEvents: AgentEvent[] = [];
  readonly findings: FindingRecord[] = [];
  private alreadyPostedOnNextClaim: number | undefined;
  private afterClearClaimResult:
    | { status: 'already_posted'; commentsPosted: number }
    | { status: 'claimed_by_other' }
    | undefined;
  private clearedClaimSinceLastClaim = false;
  private ownershipCheckFailureCountdown: number | undefined;
  private claimRefreshFailureCountdown: number | undefined;

  seedReviewRun(run: ReviewRunRecord): void {
    this.reviewRuns.push(run);
  }

  reportAlreadyPostedOnNextClaim(commentsPosted: number): void {
    this.alreadyPostedOnNextClaim = commentsPosted;
  }

  reportClaimedByOtherOnNextClaim(): void {
    this.afterClearClaimResult = { status: 'claimed_by_other' };
  }

  reportAlreadyPostedAfterClear(commentsPosted: number): void {
    this.afterClearClaimResult = { status: 'already_posted', commentsPosted };
  }

  failNextReviewPostOwnershipCheck(): void {
    this.failReviewPostOwnershipCheckAfter(1);
  }

  failReviewPostOwnershipCheckAfter(checks: number): void {
    this.ownershipCheckFailureCountdown = checks;
  }

  failReviewPostClaimRefreshAfter(refreshes: number): void {
    this.claimRefreshFailureCountdown = refreshes;
  }

  seedAgentRun(run: AgentRunRecord): void {
    this.agentRuns.push(run);
  }

  async loadPullRequestState(input: PullRequestReviewInput) {
    return {
      reviewRuns: this.reviewRuns.filter(
        (run) =>
          run.repositoryId === input.repositoryId &&
          run.pullRequestNumber === input.pullRequestNumber,
      ),
      agentRuns: this.agentRuns.filter((agentRun) =>
        this.reviewRuns.some(
          (reviewRun) =>
            reviewRun.id === agentRun.reviewRunId &&
            reviewRun.repositoryId === input.repositoryId &&
            reviewRun.pullRequestNumber === input.pullRequestNumber,
        ),
      ),
    };
  }

  async upsertReviewRun(run: ReviewRunRecord): Promise<void> {
    const index = this.reviewRuns.findIndex((existingRun) => existingRun.id === run.id);
    if (index === -1) {
      this.reviewRuns.push({ ...run });
      return;
    }
    this.reviewRuns[index] = { ...run };
  }

  async claimReviewPost(reviewRunId: string, now: Date) {
    if (this.alreadyPostedOnNextClaim !== undefined) {
      const commentsPosted = this.alreadyPostedOnNextClaim;
      this.alreadyPostedOnNextClaim = undefined;
      return { status: 'already_posted' as const, commentsPosted };
    }
    if (this.clearedClaimSinceLastClaim && this.afterClearClaimResult !== undefined) {
      this.clearedClaimSinceLastClaim = false;
      const result = this.afterClearClaimResult;
      this.afterClearClaimResult = undefined;
      return result;
    }
    const run = this.reviewRuns.find((existingRun) => existingRun.id === reviewRunId);
    if (run === undefined) return { status: 'claimed_by_other' as const };
    if (run.commentsPosted > 0) {
      return { status: 'already_posted' as const, commentsPosted: run.commentsPosted };
    }
    if (run.reviewPostClaimedAt !== undefined) {
      return { status: 'claimed_by_other' as const, claimedAt: run.reviewPostClaimedAt };
    }
    run.reviewPostClaimedAt = now;
    return { status: 'claimed' as const, claimedAt: now };
  }

  async clearReviewPostClaim(reviewRunId: string, claimedAt: Date): Promise<boolean> {
    const run = this.reviewRuns.find((existingRun) => existingRun.id === reviewRunId);
    if (
      run === undefined ||
      run.commentsPosted > 0 ||
      run.reviewPostClaimedAt?.getTime() !== claimedAt.getTime()
    ) {
      return false;
    }
    run.reviewPostClaimedAt = undefined;
    this.clearedClaimSinceLastClaim = true;
    return true;
  }

  async refreshReviewPostClaim(
    reviewRunId: string,
    claimedAt: Date,
    now: Date,
  ): Promise<Date | undefined> {
    if (this.claimRefreshFailureCountdown !== undefined) {
      this.claimRefreshFailureCountdown -= 1;
      if (this.claimRefreshFailureCountdown === 0) {
        this.claimRefreshFailureCountdown = undefined;
        return undefined;
      }
    }
    const run = this.reviewRuns.find((existingRun) => existingRun.id === reviewRunId);
    if (
      run === undefined ||
      run.commentsPosted > 0 ||
      run.reviewPostClaimedAt?.getTime() !== claimedAt.getTime()
    ) {
      return undefined;
    }
    run.reviewPostClaimedAt = now;
    return now;
  }

  async ownsReviewPostClaim(reviewRunId: string, claimedAt: Date): Promise<boolean> {
    if (this.ownershipCheckFailureCountdown !== undefined) {
      this.ownershipCheckFailureCountdown -= 1;
      if (this.ownershipCheckFailureCountdown === 0) {
        this.ownershipCheckFailureCountdown = undefined;
        return false;
      }
    }
    const run = this.reviewRuns.find((existingRun) => existingRun.id === reviewRunId);
    return (
      run !== undefined &&
      run.commentsPosted === 0 &&
      run.reviewPostClaimedAt?.getTime() === claimedAt.getTime()
    );
  }

  async upsertAgentRun(run: AgentRunRecord): Promise<void> {
    const index = this.agentRuns.findIndex((existingRun) => existingRun.id === run.id);
    if (index === -1) {
      this.agentRuns.push({ ...run });
      return;
    }
    this.agentRuns[index] = { ...run };
  }

  async upsertAgentEvent(event: AgentEvent): Promise<void> {
    const index = this.agentEvents.findIndex(
      (existingEvent) =>
        existingEvent.agentRunId === event.agentRunId && existingEvent.seq === event.seq,
    );
    if (index === -1) {
      this.agentEvents.push({ ...event });
      return;
    }
    this.agentEvents[index] = { ...event };
  }

  async upsertFinding(finding: FindingRecord): Promise<void> {
    const index = this.findings.findIndex(
      (existingFinding) =>
        existingFinding.agentRunId === finding.agentRunId &&
        existingFinding.fingerprint === finding.fingerprint,
    );
    if (index === -1) {
      this.findings.push({ ...finding });
      return;
    }
    this.findings[index] = { ...finding };
  }
}

class FakeGitHubPort implements GitHubPort {
  readonly checkRunPatches: Array<{
    repository: RepoRef;
    installationId: number;
    checkRunId: number;
    patch: CheckRunPatch;
  }> = [];
  readonly reviews: ReviewPayload[] = [];
  readonly postedReviews = new Map<string, number>();
  readonly mintReadTokenCalls: Array<{ repositoryId: number; installationId: number }> = [];
  readonly createdCheckRuns: string[] = [];
  private nextCheckRunId = 9000;
  private checkRunCreationFailuresRemaining: number;
  private checkRunUpdateFailuresRemaining: number;
  private reviewPostFailuresRemaining: number;
  private postedReviewLookupFailuresRemaining: number;
  private reviewPostResolver: (() => void) | undefined;
  private readonly reviewPostPromise = new Promise<void>((resolve) => {
    this.reviewPostResolver = resolve;
  });
  private readonly heldReviewPostResolvers: Array<() => void> = [];

  constructor(private readonly options: FakePortOptions = {}) {
    this.checkRunCreationFailuresRemaining =
      options.failCheckRunCreationsRemaining ?? (options.failCheckRunCreation ? Infinity : 0);
    this.checkRunUpdateFailuresRemaining = options.failCheckRunUpdatesRemaining ?? 0;
    this.reviewPostFailuresRemaining = options.failReviewPostsRemaining ?? 0;
    this.postedReviewLookupFailuresRemaining = options.failPostedReviewLookupsRemaining ?? 0;
  }

  async mintReadToken(repositoryId: number, installationId: number): Promise<ScopedToken> {
    this.mintReadTokenCalls.push({ repositoryId, installationId });
    return { token: 'read-token', expiresAt: new Date('2026-06-17T13:00:00.000Z') };
  }

  async getDiffContext(
    repository: RepoRef,
    pullRequestNumber: number,
    head: string,
    previousHead?: string,
  ): Promise<DiffContext> {
    return {
      headSha: head,
      baseSha: 'base000',
      prevHeadSha: previousHead,
      changedFiles: [
        {
          path: 'src/example.ts',
          status: 'modified',
          patch: '@@ -1 +1 @@',
          commentableLines: [
            { side: 'LEFT', line: 2 },
            { side: 'RIGHT', line: 3 },
            { side: 'RIGHT', line: 12 },
          ],
        },
        {
          path: 'src/second.ts',
          status: 'added',
          patch: '@@ -0,0 +1 @@',
          commentableLines: [{ side: 'RIGHT', line: 1 }],
        },
      ],
      pr: {
        number: pullRequestNumber,
        title: `${repository.owner}/${repository.name}`,
        body: 'Pull request body',
        labels: [],
        author: 'steve',
      },
    };
  }

  async createCheckRun(_repository: RepoRef, headSha: string): Promise<{ checkRunId: number }> {
    if (this.checkRunCreationFailuresRemaining > 0) {
      this.checkRunCreationFailuresRemaining -= 1;
      throw new Error('check run creation failed');
    }
    this.createdCheckRuns.push(headSha);
    this.nextCheckRunId += 1;
    return { checkRunId: this.nextCheckRunId };
  }

  async updateCheckRun(
    repository: RepoRef,
    checkRunId: number,
    patch: CheckRunPatch,
  ): Promise<void> {
    if (this.checkRunUpdateFailuresRemaining > 0) {
      this.checkRunUpdateFailuresRemaining -= 1;
      throw new Error('check run update failed');
    }
    this.checkRunPatches.push({
      repository,
      installationId: getInstallationId(repository),
      checkRunId,
      patch,
    });
  }

  async postReview(
    _repository: RepoRef,
    _pullRequestNumber: number,
    review: ReviewPayload,
  ): Promise<{ comments: number }> {
    if (this.reviewPostFailuresRemaining > 0) {
      this.reviewPostFailuresRemaining -= 1;
      if (this.options.publishFailedReviewBeforeThrowing === true) {
        const marker = /<!-- tribunal-review-run:v1:.+? -->/.exec(review.body);
        if (marker !== null) this.postedReviews.set(marker[0], review.comments.length);
      }
      throw new Error('review post failed');
    }
    this.reviewPostResolver?.();
    if (this.options.holdReviewPosts === true) {
      await new Promise<void>((resolve) => {
        this.heldReviewPostResolvers.push(resolve);
      });
    }
    this.reviews.push(review);
    const marker = /<!-- tribunal-review-run:v1:.+? -->/.exec(review.body);
    if (marker !== null) this.postedReviews.set(marker[0], review.comments.length);
    return { comments: review.comments.length };
  }

  async waitForReviewPost(): Promise<void> {
    await this.reviewPostPromise;
  }

  resolveHeldReviewPosts(): void {
    for (const resolve of this.heldReviewPostResolvers.splice(0)) {
      resolve();
    }
  }

  async findPostedReview(
    _repository: RepoRef,
    _pullRequestNumber: number,
    reviewMarker: string,
  ): Promise<{ comments: number } | undefined> {
    if (this.postedReviewLookupFailuresRemaining > 0) {
      this.postedReviewLookupFailuresRemaining -= 1;
      throw new Error('posted review lookup failed');
    }
    const comments = this.postedReviews.get(reviewMarker);
    return comments === undefined ? undefined : { comments };
  }
}

class FakeSandboxPort implements SandboxPort {
  readonly ensureCalls: Array<{ prKey: string; options: SandboxOptions }> = [];
  readonly updateCalls: Array<{
    sandboxId: string;
    repository: RepoRef;
    head: string;
    runToken: string;
  }> = [];
  readonly runAgentCalls: Array<{
    sandboxId: string;
    agentId: string;
    diffContext: DiffContext;
    runToken: string;
    model: string;
    effort: string | undefined;
  }> = [];
  readonly stopCalls: string[] = [];
  readonly terminateCalls: string[] = [];

  private runningAgentResolver: (() => void) | undefined;
  private readonly runningAgentPromise = new Promise<void>((resolve) => {
    this.runningAgentResolver = resolve;
  });
  private runningAgents = 0;
  private readonly heldAgentResolvers: Array<() => void> = [];
  private holdFutureRuns = false;

  constructor(private readonly options: FakePortOptions) {}

  async ensure(prKey: string, options: SandboxOptions): Promise<{ sandboxId: string }> {
    this.ensureCalls.push({ prKey, options });
    return { sandboxId: `sandbox-${prKey}` };
  }

  async update(
    sandboxId: string,
    repository: RepoRef,
    head: string,
    runToken: string,
  ): Promise<void> {
    this.updateCalls.push({ sandboxId, repository, head, runToken });
    if (this.options.failNextSandboxUpdate) {
      this.options.failNextSandboxUpdate = false;
      throw new Error('sandbox update failed');
    }
  }

  async runAgent(
    sandboxId: string,
    agent: AgentSpec,
    diffContext: DiffContext,
    runToken: string,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<AgentResult> {
    this.runAgentCalls.push({
      sandboxId,
      agentId: agent.id,
      diffContext,
      runToken,
      model: agent.model,
      effort: agent.effort,
    });
    this.runningAgents += 1;
    onEvent({
      agentRunId: 'placeholder',
      seq: this.runAgentCalls.length,
      kind: 'session_start',
      ...(this.options.sensitiveAgentEvent
        ? {
            detail: {
              authorization: 'Bearer ghs_abcdefghijklmnopqrstuvwxyz',
              input: { contents: 'const rawRepositoryFileContent = true;' },
            },
          }
        : {}),
      at: '2026-06-17T12:00:00.000Z',
    });
    this.runningAgentResolver?.();

    if (
      (this.options.holdAgentRuns && this.runAgentCalls.length === 1) ||
      this.options.holdAllAgentRuns ||
      this.holdFutureRuns
    ) {
      await new Promise<void>((resolve) => {
        this.heldAgentResolvers.push(resolve);
      });
    }

    if (this.options.failAgentRuns) {
      throw createSandboxFailure('sandbox runner failed', agent, this.options);
    }
    if (signal.aborted && this.options.failAbortedAgentRuns) {
      throw createSandboxFailure('process killed', agent, this.options, true);
    }

    return createAgentResult(
      agent,
      signal.aborted,
      this.options.multipleFindings,
      this.options.multiLineFinding,
      this.options.fileLevelFinding,
      this.options.mixedAnchoredAndOffDiffFindings,
      this.options.endLineOnlyFinding,
      this.options.unsafeFindings,
    );
  }

  async stop(_sandboxId: string, agentRunId: string): Promise<void> {
    this.stopCalls.push(agentRunId);
  }

  async suspend(): Promise<void> {}

  async terminate(sandboxId: string): Promise<void> {
    this.terminateCalls.push(sandboxId);
  }

  async waitForRunningAgent(): Promise<void> {
    await this.runningAgentPromise;
  }

  async waitForRunningAgents(count: number): Promise<void> {
    while (this.runningAgents < count) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  resolveHeldAgents(): void {
    for (const resolve of this.heldAgentResolvers.splice(0)) {
      resolve();
    }
  }

  holdFutureAgentRuns(): void {
    this.holdFutureRuns = true;
  }

  failNextUpdate(): void {
    this.options.failNextSandboxUpdate = true;
  }
}

function createSandboxFailure(
  message: string,
  agent: AgentSpec,
  options: FakePortOptions,
  stopped = false,
): Error {
  const error = new Error(message);
  if (options.failedAgentPartialCostEstimateUsd !== undefined) {
    const partialResult = createAgentResult(agent, stopped);
    Object.assign(error, {
      partialResult: {
        ...partialResult,
        costEstimateUsd: options.failedAgentPartialCostEstimateUsd,
        durationMs: options.failedAgentPartialDurationMs ?? partialResult.durationMs,
      },
    });
  }
  return error;
}

function getInstallationId(repository: RepoRef): number {
  const installationId = (repository as RepoRef & { installationId?: unknown }).installationId;
  return typeof installationId === 'number' ? installationId : 1001;
}

class FakeCostPort implements CostPort {
  readonly recordLlmEstimateCalls: string[] = [];
  readonly llmEstimates: LlmEstimateInput[] = [];
  readonly reconcileCalls: string[] = [];
  readonly enforceDailyCapCalls: number[] = [];
  readonly sandboxCostEvents: SandboxCostInput[] = [];
  private readonly idempotencyKeys = new Set<string>();
  private spendTodayEstimateValue: number;

  constructor(private readonly options: FakePortOptions) {
    this.spendTodayEstimateValue = options.spendTodayEstimate ?? 0;
  }

  get llmEstimateKeys(): string[] {
    return [...this.idempotencyKeys].filter((key) => key.startsWith('llm:')).sort();
  }

  async recordLlmEstimate(event: LlmEstimateInput): Promise<void> {
    this.recordLlmEstimateCalls.push(event.idempotencyKey);
    this.llmEstimates.push(event);
    this.idempotencyKeys.add(event.idempotencyKey);
    if (this.options.duplicateCostRecordCalls) {
      this.recordLlmEstimateCalls.push(event.idempotencyKey);
      this.idempotencyKeys.add(event.idempotencyKey);
    }
    if (this.options.spendAfterFirstEstimate !== undefined) {
      this.spendTodayEstimateValue = this.options.spendAfterFirstEstimate;
    }
  }

  async recordSandbox(event: SandboxCostInput): Promise<void> {
    if (this.idempotencyKeys.has(event.idempotencyKey)) return;
    this.idempotencyKeys.add(event.idempotencyKey);
    this.sandboxCostEvents.push(event);
  }

  async reconcile(reviewRunId: string): Promise<void> {
    this.reconcileCalls.push(reviewRunId);
  }

  async enforceDailyCap(userId: number): Promise<DailyCapDecision> {
    this.enforceDailyCapCalls.push(userId);
    const capUsd = 10;
    const spendUsd = this.spendTodayEstimateValue;
    return {
      allowed: spendUsd < capUsd,
      capUsd,
      spendUsd,
      remainingUsd: Math.max(0, capUsd - spendUsd),
    };
  }

  setSpendTodayEstimate(value: number): void {
    this.spendTodayEstimateValue = value;
  }
}

function createAgentResult(
  agent: AgentSpec,
  stopped: boolean,
  multipleFindings = false,
  multiLineFinding = false,
  fileLevelFinding = false,
  mixedAnchoredAndOffDiffFindings = false,
  endLineOnlyFinding = false,
  unsafeFindings = false,
): AgentResult {
  const findings = unsafeFindings
    ? [
        {
          path: '../secret.env',
          startLine: 1,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'error' as const,
          title: 'Escaped path',
          body: 'This must not persist.',
        },
        {
          path: 'src/example.ts',
          startLine: 12,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: '@team please review',
          body: '@everyone\u0000\n/approve this',
        },
        {
          path: 'src/example.ts',
          startLine: 99,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: 'Off-diff finding',
          body: 'This should be summarized instead of posted inline.',
        },
      ]
    : fileLevelFinding
      ? [
          {
            path: 'src/example.ts',
            startLine: null,
            endLine: null,
            side: 'RIGHT' as const,
            severity: 'warning' as const,
            title: 'File-level finding',
            body: 'This cannot be anchored inline.',
          },
        ]
      : mixedAnchoredAndOffDiffFindings
        ? [
            {
              path: 'src/example.ts',
              startLine: 12,
              endLine: null,
              side: 'RIGHT' as const,
              severity: 'warning' as const,
              title: 'Check this change',
              body: 'This fake finding proves review posting stays outside the agent.',
            },
            {
              path: 'src/example.ts',
              startLine: null,
              endLine: null,
              side: 'RIGHT' as const,
              severity: 'warning' as const,
              title: 'File-level finding',
              body: 'This cannot be anchored inline.',
            },
            {
              path: 'src/example.ts',
              startLine: null,
              endLine: 99,
              side: 'RIGHT' as const,
              severity: 'warning' as const,
              title: 'Off-diff line',
              body: 'This line is not commentable in the diff.',
            },
          ]
        : multiLineFinding
          ? [
              {
                path: 'src/example.ts',
                startLine: 3,
                endLine: 12,
                side: 'RIGHT' as const,
                severity: 'warning' as const,
                title: 'Multi-line finding',
                body: 'This finding should span the changed range.',
              },
            ]
          : endLineOnlyFinding
            ? [
                {
                  path: 'src/example.ts',
                  startLine: null,
                  endLine: 12,
                  side: 'RIGHT' as const,
                  severity: 'warning' as const,
                  title: 'Check this change',
                  body: 'This fake finding proves review posting stays outside the agent.',
                },
              ]
            : multipleFindings
              ? [
                  {
                    path: 'src/second.ts',
                    startLine: 1,
                    endLine: null,
                    side: 'RIGHT' as const,
                    severity: 'info' as const,
                    title: 'Second file',
                    body: 'This should sort last by path.',
                  },
                  {
                    path: 'src/example.ts',
                    startLine: 3,
                    endLine: null,
                    side: 'RIGHT' as const,
                    severity: 'error' as const,
                    title: 'Earlier right side',
                    body: 'This should sort before the later right-side comment.',
                  },
                  {
                    path: 'src/example.ts',
                    startLine: 12,
                    endLine: null,
                    side: 'RIGHT' as const,
                    severity: 'warning' as const,
                    title: 'Right side',
                    body: 'This should sort after the left-side comment.',
                  },
                  {
                    path: 'src/example.ts',
                    startLine: 2,
                    endLine: null,
                    side: 'LEFT' as const,
                    severity: 'warning' as const,
                    title: 'Left side',
                    body: 'This should sort first within the file.',
                  },
                ]
              : [
                  {
                    path: 'src/example.ts',
                    startLine: 12,
                    endLine: null,
                    side: 'RIGHT' as const,
                    severity: 'warning' as const,
                    title: 'Check this change',
                    body: 'This fake finding proves review posting stays outside the agent.',
                  },
                ];

  return {
    agentSlug: agent.slug,
    findings: stopped ? [] : findings,
    modelUsed: agent.model,
    effortUsed: agent.effort ?? null,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: 0.01,
    durationMs: 25,
    stopped: stopped ? 'superseded' : undefined,
  };
}
