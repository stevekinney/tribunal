import { describe, expect, it } from 'vitest';
import { verifyCapabilityToken } from '@tribunal/review-core/capability-token';
import type { PullRequestReviewInput } from './review-workflow';
import {
  baseInput,
  createEngine,
  createExpectedReviewMarker,
  createFakePorts,
  createIntent,
  performanceAgent,
  reviewAgent,
} from './review-workflow-test-support';

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

  it('PATCHes the intent-supplied Check Run for the pushed head, not the stale one from the opened event', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    // opened at head A has no intent-supplied checkRunId, so the engine falls
    // back to creating its own Check Run (id 9001, per FakeGitHubPort).
    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      headSha: 'aaa111',
    });
    const checkRunIdForHeadA = ports.github.checkRunPatches.at(-1)?.checkRunId;
    expect(checkRunIdForHeadA).toBeDefined();

    // synchronize at head B arrives with its own intent-supplied checkRunId
    // (T-1 already created it at webhook-intent time) — this must be the id
    // every subsequent PATCH targets, not head A's.
    const updatedInput: PullRequestReviewInput = {
      ...baseInput,
      headSha: 'bbb222',
      trigger: 'synchronize',
      checkRunId: 424242,
    };
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'posted',
      headSha: 'bbb222',
    });

    const patchesForHeadB = ports.github.checkRunPatches.filter(
      (call) => call.checkRunId === 424242,
    );
    expect(patchesForHeadB.length).toBeGreaterThan(0);
    // The fake sandbox's default agent result includes a finding, so the
    // completed conclusion is advisory `neutral`, not `success`.
    expect(patchesForHeadB.at(-1)).toMatchObject({
      checkRunId: 424242,
      patch: { status: 'completed', conclusion: 'neutral' },
    });
    // No PATCH for head B's run should have leaked onto head A's stale check run.
    expect(
      ports.github.checkRunPatches.every(
        (call) => call.checkRunId === checkRunIdForHeadA || call.checkRunId === 424242,
      ),
    ).toBe(true);
    // The fallback create path only ever ran once, for head A.
    expect(ports.github.createdCheckRuns).toEqual(['aaa111']);
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

  it('reuses the posted review run for a repeat manual re-review on the same sha', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    const manualInput: PullRequestReviewInput = { ...baseInput, trigger: 'manual' };

    await expect(engine.startPullRequestReview(manualInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:manual',
      status: 'posted',
    });
    const runsAfterFirstClick = ports.sandbox.runAgentCalls.length;

    // A second "Re-review" click on the same head_sha resolves to the same
    // review_run id and reuses the already-posted run instead of re-running agents.
    await expect(engine.startPullRequestReview(manualInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:manual',
      status: 'posted',
    });

    expect(ports.sandbox.runAgentCalls).toHaveLength(runsAfterFirstClick);
    expect(ports.github.reviews).toHaveLength(1);
  });

  it('flips a stale completed Check Run back to in_progress for a genuine re-review after completion', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
    });
    const checkRunId = ports.github.checkRunPatches.at(-1)?.checkRunId;
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed' },
    });
    const runsAfterFirstReview = ports.sandbox.runAgentCalls.length;
    expect(runsAfterFirstReview).toBeGreaterThan(0);

    // A "Re-review" action arrives for the same (already-completed) head sha,
    // reusing the Check Run id the original review created — the same
    // pattern the check-run/check-suite re-run webhook handlers use.
    const manualInput: PullRequestReviewInput = { ...baseInput, trigger: 'manual', checkRunId };
    await expect(engine.startPullRequestReview(manualInput)).resolves.toMatchObject({
      id: 'run:42:7:aaa111:manual',
      status: 'posted',
    });

    const patchesForCheckRun = ports.github.checkRunPatches.filter(
      (call) => call.checkRunId === checkRunId,
    );
    // The stale `completed` conclusion from the first run is flipped back to
    // `in_progress` before the manual re-review's agents run, and only then
    // back to `completed` once the new run finishes — it must never sit on
    // GitHub's Checks tab (or a required-check gate) showing the prior run's
    // stale conclusion while the re-review is in flight.
    expect(patchesForCheckRun.map((call) => call.patch.status)).toEqual([
      'completed',
      'in_progress',
      'completed',
    ]);
    // The diff-unchanged skip must never swallow an explicitly requested
    // manual re-review: the second run has to genuinely re-run agents and
    // post a second review, not silently reuse the first run's results.
    expect(ports.sandbox.runAgentCalls.length).toBeGreaterThan(runsAfterFirstReview);
    expect(ports.github.reviews).toHaveLength(2);
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
    const specialistAgentRuns = ports.state.agentRuns.filter((run) => run.role === 'specialist');
    expect(specialistAgentRuns.map((run) => [run.id, run.status, run.userId])).toEqual([
      ['arun:run:42:7:aaa111:opened:agent_security', 'succeeded', 1],
    ]);
    expect(specialistAgentRuns[0]).toMatchObject({
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
  });

  // Per-run cost reconciliation was removed (see #215): the Anthropic cost
  // report endpoint has no run/request/credential dimension, so a per-run
  // `reconcile()` call can only ever attribute the organization's entire
  // daily spend to one run. `FakeCostPort.reconcile` below is not part of
  // `CostPort` and always throws — it exists purely as a tripwire so a
  // regression that reintroduces a call at this boundary fails loudly
  // instead of silently reconciling again.
  it('completes a review run to posted without ever calling cost reconciliation', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });

    expect(ports.cost.reconcileCalls).toEqual([]);
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
    expect(engine.snapshot().agentRuns.filter((run) => run.role === 'specialist')).toEqual([
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
    // The push to bbb222 gets its own Check Run (T-1/T-2: one per head_sha),
    // distinct from aaa111's — not a reuse of the original supervisor check run.
    // A terminal engine failure (the run never posted) maps to `failure`.
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      checkRunId: 9002,
      installationId: 1001,
      patch: {
        status: 'completed',
        conclusion: 'failure',
        output: {
          title: 'Tribunal review failed',
          summary: expect.stringContaining('sandbox update failed'),
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

  it('completes the check run with conclusion success (not cancelled) when the pull request merges', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.signalPullRequestClosed(baseInput, 'merged');
    ports.sandbox.resolveHeldAgents();
    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'success' },
    });
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
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      status: 'quota_blocked',
      costEstimateUsd: 0,
    });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('blocks before triage when the remaining budget cannot cover a reservation', async () => {
    const ports = createFakePorts({
      spendTodayEstimate: 9.99,
      unboundedReservationAmountUsd: 0.02,
    });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'quota_blocked',
    });

    expect(ports.cost.enforceDailyCapCalls).toEqual([1, 1]);
    expect(ports.cost.reservationCalls).toEqual([
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:triage:estimate',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
    ]);
    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('honors cancellation after a triage reservation wait', async () => {
    const ports = createFakePorts({ holdDailyCapReservationCall: 1 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.cost.waitForDailyCapReservation();

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.cost.resolveHeldDailyCapReservations();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.cost.releasedReservationKeys).toContain(
      'llm:arun:run:42:7:aaa111:opened:triage:estimate',
    );
    expect(ports.github.reviews).toHaveLength(0);
  });

  it('does not overwrite cancellation with a denied triage reservation result', async () => {
    const ports = createFakePorts({ holdDailyCapReservationCall: 1 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.cost.waitForDailyCapReservation();

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.cost.setSpendTodayEstimate(10);
    ports.cost.resolveHeldDailyCapReservations();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.github.reviews).toHaveLength(0);
  });

  it('records one LLM estimate per agent run even when a retry reaches the cost boundary twice', async () => {
    const ports = createFakePorts({ duplicateCostRecordCalls: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.cost.reservationCalls).toEqual([
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:triage:estimate',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:agent_security:estimate',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
      {
        idempotencyKey: expect.stringMatching(
          /^llm:arun:run:42:7:aaa111:opened:verify:[^:]+:estimate$/u,
        ),
        amountUsd: 0.05,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
    ]);
    const specialistKey = 'llm:arun:run:42:7:aaa111:opened:agent_security:estimate';
    expect(ports.cost.recordLlmEstimateCalls.filter((key) => key === specialistKey)).toHaveLength(
      2,
    );
    expect(ports.cost.llmEstimateKeys).toContain(specialistKey);
    expect(new Set(ports.cost.llmEstimateKeys).size).toBe(ports.cost.llmEstimateKeys.length);
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
    expect(
      ports.cost.llmEstimates.find((estimate) => estimate.agentId === 'agent_security'),
    ).toMatchObject({ amountUsd: 0.42 });
  });

  it('reports the persisted completed run total in the Check Run cost headline', async () => {
    const ports = createFakePorts({
      triageCostEstimateUsd: 0.02,
      verificationCostEstimateUsd: 0.03,
    });
    const engine = createEngine(ports);

    const result = await engine.startPullRequestReview(baseInput);

    expect(result.status).toBe('posted');
    expect(result.costEstimateUsd).toBeCloseTo(0.06);

    const completedPatch = ports.github.checkRunPatches.at(-1)?.patch;
    expect(completedPatch).toMatchObject({
      status: 'completed',
      output: {
        summary: expect.stringContaining('Estimated cost: $0.0600.'),
      },
    });
    expect(completedPatch?.output?.summary).toContain(
      '- security-review: completed; model sonnet; effort medium; findings 1 (info 0, warning 1, error 0); estimated cost $0.0100.',
    );
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

  it('rejects whitespace-only partial failed agent cost from the sandbox', async () => {
    const ports = createFakePorts({
      failAgentRuns: true,
      failedAgentPartialCostEstimateUsd: '   ',
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

  it('skips agent execution by default when every changed file matches the default lockfile/vendor ignore globs', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    const originalGetDiffContext = ports.github.getDiffContext.bind(ports.github);
    ports.github.getDiffContext = async (...arguments_) => {
      const diffContext = await originalGetDiffContext(...arguments_);
      return {
        ...diffContext,
        changedFiles: [{ ...diffContext.changedFiles[0]!, path: 'bun.lock' }],
      };
    };

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { conclusion: 'success', output: { summary: 'Only ignored paths changed.' } },
    });
  });

  it('skips agent execution when triage decides there is nothing reviewable', async () => {
    const ports = createFakePorts({ triageSkip: 'Pure rename with no semantic change.' });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.github.reviews).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review skipped',
          summary: expect.stringContaining('Pure rename with no semantic change.'),
        },
      },
    });
  });

  it('skips agent execution when the diff is unchanged since the last posted review (patch-id skip)', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);
    ports.sandbox.runAgentCalls.length = 0;

    // Same head sha reuses the posted run via the existing run-id dedup path;
    // a *different* head sha with the same diff content should hit the new
    // patch-id skip instead of re-running agents.
    const result = await engine.signalCommitPushed({
      ...baseInput,
      headSha: 'aaa111', // identical patch content to baseInput's diff fixture
    });

    expect(result.status).toBe('posted');
    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
  });

  it('kills a planted false positive: an unverified finding never posts', async () => {
    const ports = createFakePorts({ rejectAllFindings: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(ports.github.reviews).toHaveLength(0);
    const findings = ports.state.findings;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verificationStatus === 'rejected')).toBe(true);
  });

  it('persists verified findings with their verifier agent run id', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.state.findings.length).toBeGreaterThan(0);
    for (const finding of ports.state.findings) {
      expect(finding.verificationStatus).toBe('verified');
      expect(finding.verifierAgentRunId).toMatch(/^arun:.*:verify:/);
    }
  });

  it('does not post a superseded run whose verifier finishes after the supersede signal', async () => {
    const ports = createFakePorts({ holdVerifierRuns: true });
    const engine = createEngine(ports);

    const firstRun = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningVerifier();

    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };
    const secondRun = engine.signalCommitPushed(updatedInput);
    // Let the first run's held verifier resolve as if it completed just after
    // the supersede signal arrived — a superseded run must never post,
    // regardless of what an in-flight verifier eventually decides.
    ports.sandbox.resolveHeldVerifiers();

    await expect(firstRun).resolves.toMatchObject({ status: 'superseded' });
    await expect(secondRun).resolves.toMatchObject({ status: 'posted', headSha: 'bbb222' });

    expect(ports.github.reviews).toHaveLength(1);
  });

  it('merges near-duplicate findings from different agents before posting', async () => {
    const ports = createFakePorts({
      agentFindingsBySlug: {
        'security-review': [
          {
            path: 'src/example.ts',
            startLine: 12,
            endLine: null,
            side: 'RIGHT',
            severity: 'error',
            title: 'Missing authorization check',
            body: 'Confirmed via read tools.',
          },
        ],
        'performance-review': [
          {
            path: 'src/example.ts',
            startLine: 12,
            endLine: null,
            side: 'RIGHT',
            severity: 'warning',
            title: 'Authorization check missing',
            body: 'Same issue, different wording.',
          },
        ],
      },
    });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [reviewAgent, performanceAgent],
    });

    expect(ports.github.reviews).toHaveLength(1);
    expect(ports.github.reviews[0]!.comments).toHaveLength(1);
    expect(ports.github.reviews[0]!.comments[0]).toMatchObject({
      body: expect.stringContaining('Missing authorization check'),
    });

    // The surviving finding's persisted row records the absorbed
    // fingerprint, so Phase 3's carried-forward dedup can match a
    // re-reported finding against either fingerprint.
    const survivorRow = ports.state.findings.find(
      (row) => row.title === 'Missing authorization check',
    );
    expect(survivorRow?.mergedFingerprints).toHaveLength(1);
    expect(survivorRow?.verificationStatus).toBe('verified');
    const absorbedRow = ports.state.findings.find(
      (row) => row.title === 'Authorization check missing',
    );
    expect(survivorRow?.mergedFingerprints).toEqual([absorbedRow?.fingerprint]);
    // The absorbed ("loser") finding must be re-tagged `merged` — it was
    // already persisted as `verified` by the verification stage before the
    // merge step ran, and must never be double-counted as a second verified
    // finding alongside its survivor.
    expect(absorbedRow?.verificationStatus).toBe('merged');
  });

  it('records no merged fingerprints on a finding row when nothing was absorbed', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.state.findings.length).toBeGreaterThan(0);
    for (const row of ports.state.findings) {
      expect(row.mergedFingerprints ?? []).toEqual([]);
    }
  });

  it('posts distinct findings from different agents on the same line without merging them', async () => {
    const ports = createFakePorts({
      agentFindingsBySlug: {
        'security-review': [
          {
            path: 'src/example.ts',
            startLine: 12,
            endLine: null,
            side: 'RIGHT',
            severity: 'error',
            title: 'Missing authorization check',
            body: 'Confirmed via read tools.',
          },
        ],
        'performance-review': [
          {
            path: 'src/example.ts',
            startLine: 12,
            endLine: null,
            side: 'RIGHT',
            severity: 'warning',
            title: 'Unbounded query allocates excessive memory',
            body: 'Unrelated issue on the same line.',
          },
        ],
      },
    });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [reviewAgent, performanceAgent],
    });

    expect(ports.github.reviews).toHaveLength(1);
    expect(ports.github.reviews[0]!.comments).toHaveLength(2);
    const bodies = ports.github.reviews[0]!.comments.map((comment) => comment.body);
    expect(bodies.some((body) => body.includes('Missing authorization check'))).toBe(true);
    expect(bodies.some((body) => body.includes('Unbounded query allocates excessive memory'))).toBe(
      true,
    );
  });

  it('bounds verifier concurrency to at most 4 in-flight sandbox processes', async () => {
    const ports = createFakePorts({
      agentFindingsBySlug: {
        'security-review': Array.from({ length: 8 }, (_, index) => ({
          path: 'src/example.ts',
          startLine: index + 1,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: `Distinct finding ${index}`,
          body: `Independent issue number ${index}.`,
        })),
      },
    });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({ ...baseInput, agents: [reviewAgent] });

    expect(ports.sandbox.maxConcurrentVerifiers).toBeLessThanOrEqual(4);
    expect(ports.sandbox.maxConcurrentVerifiers).toBeGreaterThan(1);
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

  it('honors cancellation after a specialist reservation wait', async () => {
    const ports = createFakePorts({ holdDailyCapReservationCall: 2 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.cost.waitForDailyCapReservations(2);

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.cost.resolveHeldDailyCapReservations();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.cost.releasedReservationKeys).toContain(
      'llm:arun:run:42:7:aaa111:opened:agent_security:estimate',
    );
    expect(ports.github.reviews).toHaveLength(0);
  });

  it('does not overwrite cancellation with a denied specialist reservation result', async () => {
    const ports = createFakePorts({ holdDailyCapReservationCall: 2 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.cost.waitForDailyCapReservations(2);

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.cost.setSpendTodayEstimate(10);
    ports.cost.resolveHeldDailyCapReservations();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.github.reviews).toHaveLength(0);
  });

  it('blocks a specialist when remaining budget is below its configured maximum', async () => {
    const ports = createFakePorts({ spendTodayEstimate: 9.95 });
    const engine = createEngine(ports);

    await expect(
      engine.startPullRequestReview({
        ...baseInput,
        agents: [{ ...reviewAgent, maxBudgetUsd: 0.1 }],
      }),
    ).resolves.toMatchObject({ status: 'quota_blocked' });

    expect(ports.cost.reservationCalls).toEqual([
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:triage:estimate',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:agent_security:estimate',
        amountUsd: 0.1,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
    ]);
    expect(ports.sandbox.runAgentCalls.map((call) => call.agentId)).toEqual([]);
    expect(ports.github.reviews).toHaveLength(0);
  });

  it('blocks verifier agents when the daily cap is reached after specialist review', async () => {
    const ports = createFakePorts({ spendAfterFirstEstimate: 10 });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'quota_blocked',
    });

    expect(ports.cost.reservationCalls).toEqual([
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:triage:estimate',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
      {
        idempotencyKey: 'llm:arun:run:42:7:aaa111:opened:agent_security:estimate',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
      {
        idempotencyKey: expect.stringMatching(
          /^llm:arun:run:42:7:aaa111:opened:verify:[^:]+:estimate$/u,
        ),
        amountUsd: 0.05,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
    ]);
    expect(ports.github.reviews).toHaveLength(0);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({ costEstimateUsd: 0.01 });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('honors cancellation after a verifier reservation wait', async () => {
    const ports = createFakePorts({ holdDailyCapReservationCall: 3 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.cost.waitForDailyCapReservations(3);

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.cost.resolveHeldDailyCapReservations();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls.map((call) => call.agentId)).toEqual(['agent_security']);
    expect(ports.cost.releasedReservationKeys).toEqual([
      expect.stringMatching(/^llm:arun:run:42:7:aaa111:opened:verify:[^:]+:estimate$/u),
    ]);
    expect(ports.github.reviews).toHaveLength(0);
  });

  it('releases a reservation when agent setup persistence fails', async () => {
    const ports = createFakePorts({ failAgentRunPersistence: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'agent run persistence failed',
    );
    expect(ports.cost.releasedReservationKeys).toContain(
      'llm:arun:run:42:7:aaa111:opened:triage:estimate',
    );
  });

  it('does not overwrite cancellation with a denied verifier reservation result', async () => {
    const ports = createFakePorts({ holdDailyCapReservationCall: 3 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.cost.waitForDailyCapReservations(3);

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.cost.setSpendTodayEstimate(10);
    ports.cost.resolveHeldDailyCapReservations();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls.map((call) => call.agentId)).toEqual(['agent_security']);
    expect(ports.github.reviews).toHaveLength(0);
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
        // Advisory mode: a finding present (even an unanchorable one) makes
        // the conclusion `neutral`, not `success`.
        conclusion: 'neutral',
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
    // Capture references before the `toMatchObject` assertion below: bun:test
    // (1.3.13) mutates the received object in place when it contains a
    // nested `expect.arrayContaining`/`expect.stringContaining` matcher,
    // replacing that field with the matcher instance itself. Asserting
    // against these captured values instead of re-reading through
    // `completedCheckRunPatch` afterward keeps this test correct regardless
    // of that bug.
    const annotations = completedCheckRunPatch?.patch.output?.annotations;
    const outputText = completedCheckRunPatch?.patch.output?.text;

    expect(completedCheckRunPatch).toMatchObject({
      patch: {
        status: 'completed',
        // Advisory mode: findings present makes the conclusion `neutral`.
        conclusion: 'neutral',
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
    expect(annotations).toHaveLength(3);
    expect(outputText).not.toContain('Right side');
    expect(outputText).not.toContain('Earlier right side');
    expect(outputText).not.toContain('Second file');
    expect(annotations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startLine: 2,
          title: '[security-review] Left side',
        }),
      ]),
    );
  });

  it('completes with conclusion success when the run posts clean with no findings', async () => {
    const ports = createFakePorts({ noFindings: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'success' },
    });
  });

  it('defaults to advisory mode (neutral) for an error-severity finding when checkConclusionMode is unset', async () => {
    const ports = createFakePorts({ multipleFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('stays neutral in gating mode for warning/info findings (no error severity present)', async () => {
    const ports = createFakePorts({ endLineOnlyFinding: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({ ...baseInput, checkConclusionMode: 'gating' });

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('completes with conclusion failure in gating mode when an error-severity finding is present', async () => {
    const ports = createFakePorts({ multipleFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({ ...baseInput, checkConclusionMode: 'gating' });

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'failure' },
    });
  });

  it('stays success in gating mode for a clean run with no findings', async () => {
    const ports = createFakePorts({ noFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({ ...baseInput, checkConclusionMode: 'gating' });

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'success' },
    });
  });

  it('stays neutral in gating mode when an agent fails but no error-severity finding is present', async () => {
    const ports = createFakePorts({ failAgentRuns: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview({ ...baseInput, checkConclusionMode: 'gating' });

    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
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

  it('cancels a running review through the workflow stop signal', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(engine.stopWorkflow('review:pr:42:7')).resolves.toEqual({
      stopped: true,
    });
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_security']);
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-42-7']);
    expect(engine.snapshot().agentRuns[0]).toMatchObject({ stoppedReason: 'pr_closed' });
    expect(engine.snapshot().supervisors).toEqual([]);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'cancelled',
        output: {
          title: 'Tribunal review stopped',
          summary: 'Repository removed; stopped in-flight review work.',
        },
      },
    });
  });

  it('explains when policy cancellation stops work because reviews were paused', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(engine.stopWorkflow('review:pr:42:7', 'reviews_paused')).resolves.toEqual({
      stopped: true,
    });
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'cancelled',
        output: {
          title: 'Tribunal review cancelled',
          summary: 'Reviews paused; stopped in-flight review work.',
        },
      },
    });
  });

  it('explains when policy cancellation stops work because the repository was unwatched', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(engine.stopWorkflow('review:pr:42:7', 'repository_unwatched')).resolves.toEqual({
      stopped: true,
    });
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'cancelled',
        output: {
          title: 'Tribunal review cancelled',
          summary: 'Repository unwatched; stopped in-flight review work.',
        },
      },
    });
  });

  it('does not cancel another user review for the same repository and pull request', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();
    const otherUserReview = engine.startPullRequestReview({
      ...baseInput,
      userId: baseInput.userId + 1,
    });
    await Promise.resolve();

    await expect(
      engine.stopWorkflow('review:pr:42:7', 'repository_unwatched', baseInput.userId + 1),
    ).resolves.toEqual({ stopped: false });

    expect(ports.sandbox.stopCalls).toEqual([]);
    expect(ports.github.checkRunPatches).toEqual([]);
    expect(engine.snapshot().reviewRuns.at(-1)).toMatchObject({
      status: 'running',
    });

    await engine.stopWorkflow('review:pr:42:7', 'repository_unwatched', baseInput.userId);
    ports.sandbox.resolveHeldAgents();
    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    await expect(otherUserReview).resolves.toMatchObject({ userId: baseInput.userId });
  });

  it('terminates workflow resources even when the stop check update fails', async () => {
    const ports = createFakePorts({ holdAgentRuns: true, failCheckRunUpdatesRemaining: 1 });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(engine.stopWorkflow('review:pr:42:7')).resolves.toEqual({
      stopped: true,
    });
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_security']);
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-42-7']);
    expect(engine.snapshot().supervisors).toEqual([]);
  });

  it('cancels a workflow whose supervisor is still being created', async () => {
    const ports = createFakePorts({ holdSandboxEnsure: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForEnsure();

    const stopResult = engine.stopWorkflow('review:pr:42:7');
    ports.sandbox.resolveHeldEnsures();

    await expect(stopResult).resolves.toEqual({ stopped: true });
    await expect(runningReview).rejects.toThrow(
      'Cannot start a review for a closed pull request supervisor.',
    );
    expect(ports.sandbox.runAgentCalls).toEqual([]);
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-42-7']);
    expect(engine.snapshot().supervisors).toEqual([]);
  });

  it('waits for setup-stage review work to observe workflow cancellation', async () => {
    const ports = createFakePorts({ holdDiffContext: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.github.waitForDiffContext();

    let stopResolved = false;
    const stopResult = engine.stopWorkflow('review:pr:42:7').then((result) => {
      stopResolved = true;
      return result;
    });
    await Promise.resolve();

    expect(stopResolved).toBe(false);
    expect(ports.sandbox.runAgentCalls).toEqual([]);

    ports.github.resolveHeldDiffContexts();

    await expect(stopResult).resolves.toEqual({ stopped: true });
    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.runAgentCalls).toEqual([]);
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-42-7']);
    expect(engine.snapshot().supervisors).toEqual([]);
  });

  it('clears stopped workflow sandbox state before persistence can hydrate it again', async () => {
    const ports = createFakePorts({ holdDiffContext: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.github.waitForDiffContext();

    const stopResult = engine.stopWorkflow('review:pr:42:7');
    ports.github.resolveHeldDiffContexts();

    await expect(stopResult).resolves.toEqual({ stopped: true });
    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled', sandboxId: '' });
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'cancelled',
      sandboxId: '',
    });

    ports.github.stopHoldingDiffContexts();
    const restartedEngine = createEngine(ports);
    await expect(restartedEngine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });
    expect(ports.sandbox.ensureCalls).toHaveLength(2);
    expect(ports.sandbox.ensureCalls[1]?.prKey).toBe('tribunal-pr-42-7');
  });

  it('ignores workflow stop signals when no active workflow matches', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(engine.stopWorkflow('review:pr:42:7')).resolves.toEqual({ stopped: false });

    expect(ports.sandbox.stopCalls).toEqual([]);
    expect(ports.github.checkRunPatches).toEqual([]);
  });

  it('does not overwrite a completed review outcome when workflow cancellation arrives late', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
    });
    const completedPatch = ports.github.checkRunPatches.at(-1);
    const patchCount = ports.github.checkRunPatches.length;

    await expect(engine.stopWorkflow('review:pr:42:7', 'reviews_paused')).resolves.toEqual({
      stopped: true,
    });

    expect(ports.github.checkRunPatches).toHaveLength(patchCount);
    expect(ports.github.checkRunPatches.at(-1)).toBe(completedPatch);
    expect(ports.state.reviewRuns.at(-1)).toMatchObject({
      id: 'run:42:7:aaa111:opened',
      status: 'posted',
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
    expect(
      ports.cost.llmEstimates.find((estimate) => estimate.agentId === 'agent_security'),
    ).toMatchObject({ amountUsd: 0.21 });
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
