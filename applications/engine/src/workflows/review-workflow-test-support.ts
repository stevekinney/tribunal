import { createHmac } from 'node:crypto';
import type {
  AgentEvent,
  AgentResult,
  AgentSpec,
  CheckRunPatch,
  CostPort,
  DailyCapDecision,
  DiffContext,
  Finding,
  GitHubPort,
  LlmEstimateInput,
  RepoRef,
  ReviewPayload,
  SandboxCostInput,
  SandboxOptions,
  SandboxPort,
} from '@tribunal/review-core';
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

/**
 * Shared fixtures and fakes for `review-workflow.test.ts` and
 * `review-workflow-default-model.test.ts` (a companion file scoped to
 * default-model resolution — split out to keep both files comfortably under
 * the max-lines lint budget rather than growing one already-large file
 * further). This module has no `describe`/`it` blocks and is not itself a
 * test file — it's pure fixtures.
 */

const repository = { owner: 'lostgradient', name: 'tribunal' };

export const reviewAgent: AgentSpec = {
  id: 'agent_security',
  slug: 'security-review',
  description: 'Looks for risky changes.',
  body: 'Review the pull request for security issues.',
  model: 'sonnet',
  effort: 'medium',
  enabled: true,
};

export const performanceAgent: AgentSpec = {
  ...reviewAgent,
  id: 'agent_performance',
  slug: 'performance-review',
  description: 'Looks for performance issues.',
};

export const baseInput: PullRequestReviewInput = {
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

export function createEngine(
  ports: FakePorts,
  durableState: DurableReviewWorkflowState = {},
): ReviewWorkflowEngine {
  return new ReviewWorkflowEngine(
    ports,
    {
      proxySigningKey: 'proxy-signing-key',
      runTokenTtlSeconds: 60 * 60,
      idleSuspendSeconds: 900,
      defaultModel: 'sonnet',
    },
    () => new Date('2026-06-17T12:00:00.000Z'),
    durableState,
  );
}

export function createExpectedReviewMarker(reviewRunId: string): string {
  const signature = createHmac('sha256', 'proxy-signing-key')
    .update(reviewRunId)
    .digest('base64url');
  return `<!-- tribunal-review-run:v1:${reviewRunId}:${signature} -->`;
}

export function createIntent(
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

export type FakePorts = {
  github: FakeGitHubPort;
  sandbox: FakeSandboxPort;
  cost: FakeCostPort;
  intents: FakeReviewIntentPort;
  state: FakeReviewWorkflowStatePort;
};

export function createFakePorts(options: FakePortOptions = {}): FakePorts {
  return {
    github: new FakeGitHubPort(options),
    sandbox: new FakeSandboxPort(options),
    cost: new FakeCostPort(options),
    intents: new FakeReviewIntentPort(options),
    state: new FakeReviewWorkflowStatePort(),
  };
}

export type FakePortOptions = {
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
  holdDiffContext?: boolean;
  publishFailedReviewBeforeThrowing?: boolean;
  multipleFindings?: boolean;
  multiLineFinding?: boolean;
  fileLevelFinding?: boolean;
  mixedAnchoredAndOffDiffFindings?: boolean;
  endLineOnlyFinding?: boolean;
  unsafeFindings?: boolean;
  noFindings?: boolean;
  sensitiveAgentEvent?: boolean;
  processedIntentClaimMatches?: boolean;
  spendAfterFirstEstimate?: number;
  holdReviewPosts?: boolean;
  failedAgentPartialCostEstimateUsd?: number | string;
  failedAgentPartialDurationMs?: number;
  holdSandboxEnsure?: boolean;
  /** Triage decides to skip the review entirely (T-9). */
  triageSkip?: string | false;
  triageCostEstimateUsd?: number;
  verificationCostEstimateUsd?: number;
  /** Verifier rejects every candidate finding (T-10). */
  rejectAllFindings?: boolean;
  /** Holds the first verifier's completion so a supersede/abort can race it (T-10/T-12). */
  holdVerifierRuns?: boolean;
  /** Per-agent-slug finding overrides, for cross-agent dedup scenarios (T-11). */
  agentFindingsBySlug?: Record<string, Finding[]>;
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
  private diffContextResolver: (() => void) | undefined;
  private readonly diffContextPromise = new Promise<void>((resolve) => {
    this.diffContextResolver = resolve;
  });
  private readonly heldDiffContextResolvers: Array<() => void> = [];

  constructor(private readonly options: FakePortOptions = {}) {
    this.checkRunCreationFailuresRemaining =
      options.failCheckRunCreationsRemaining ?? (options.failCheckRunCreation ? Infinity : 0);
    this.checkRunUpdateFailuresRemaining = options.failCheckRunUpdatesRemaining ?? 0;
    this.reviewPostFailuresRemaining = options.failReviewPostsRemaining ?? 0;
    this.postedReviewLookupFailuresRemaining = options.failPostedReviewLookupsRemaining ?? 0;
  }

  async getDiffContext(
    repository: RepoRef,
    pullRequestNumber: number,
    head: string,
    previousHead?: string,
  ): Promise<DiffContext> {
    this.diffContextResolver?.();
    if (this.options.holdDiffContext) {
      await new Promise<void>((resolve) => {
        this.heldDiffContextResolvers.push(resolve);
      });
    }
    return {
      headSha: head,
      baseSha: 'base000',
      prevHeadSha: previousHead,
      changedFiles: [
        {
          path: 'src/example.ts',
          status: 'modified',
          // Embeds `head` so distinct pushes produce a distinct patch id
          // (`computePatchId`) — most tests simulate a genuinely new diff per
          // push; the patch-id skip is exercised explicitly where a test
          // wants the "identical diff" rebase scenario (see below).
          patch: `@@ -1 +1 @@\n+${head}`,
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

  async waitForDiffContext(): Promise<void> {
    await this.diffContextPromise;
  }

  resolveHeldDiffContexts(): void {
    for (const resolve of this.heldDiffContextResolvers.splice(0)) {
      resolve();
    }
  }

  stopHoldingDiffContexts(): void {
    this.options.holdDiffContext = false;
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
  private runningVerifierResolver: (() => void) | undefined;
  private readonly runningVerifierPromise = new Promise<void>((resolve) => {
    this.runningVerifierResolver = resolve;
  });
  private verifierCalls = 0;
  private readonly heldVerifierResolvers: Array<() => void> = [];
  private concurrentVerifiers = 0;
  private ensureResolver: (() => void) | undefined;
  private readonly ensurePromise = new Promise<void>((resolve) => {
    this.ensureResolver = resolve;
  });
  private readonly heldEnsureResolvers: Array<() => void> = [];
  maxConcurrentVerifiers = 0;

  constructor(private readonly options: FakePortOptions) {}

  async ensure(prKey: string, options: SandboxOptions): Promise<{ sandboxId: string }> {
    this.ensureCalls.push({ prKey, options });
    this.ensureResolver?.();
    if (this.options.holdSandboxEnsure) {
      await new Promise<void>((resolve) => {
        this.heldEnsureResolvers.push(resolve);
      });
    }
    return { sandboxId: `sandbox-${prKey}` };
  }

  async waitForEnsure(): Promise<void> {
    await this.ensurePromise;
  }

  resolveHeldEnsures(): void {
    for (const resolve of this.heldEnsureResolvers.splice(0)) {
      resolve();
    }
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
    // Triage and verifier runs are trivial system-role passthroughs in this
    // fake: they must not consume the specialist-oriented hold/fail/finding
    // simulation below (indexed on `runAgentCalls.length`), and by default
    // they let specialist findings through unchanged so existing specialist
    // scenarios don't have to know about the pipeline stages around them.
    if (agent.role === 'triage') {
      return createSystemRoleAgentResult(agent, {
        triage: {
          skip: this.options.triageSkip !== undefined && this.options.triageSkip !== false,
          reason: typeof this.options.triageSkip === 'string' ? this.options.triageSkip : '',
        },
        costEstimateUsd: this.options.triageCostEstimateUsd ?? 0,
      });
    }
    if (agent.role === 'verifier') {
      this.verifierCalls += 1;
      this.runningVerifierResolver?.();
      this.concurrentVerifiers += 1;
      this.maxConcurrentVerifiers = Math.max(this.maxConcurrentVerifiers, this.concurrentVerifiers);
      if (this.options.holdVerifierRuns && this.verifierCalls === 1) {
        await new Promise<void>((resolve) => {
          this.heldVerifierResolvers.push(resolve);
        });
      } else {
        // Yield a microtask so concurrently-dispatched verifier workers can
        // overlap in this fake the same way real sandbox subprocesses would.
        await Promise.resolve();
      }
      this.concurrentVerifiers -= 1;
      return createSystemRoleAgentResult(agent, {
        verification: { verified: this.options.rejectAllFindings !== true, note: 'ok' },
        costEstimateUsd: this.options.verificationCostEstimateUsd ?? 0,
      });
    }

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

    const overrideFindings = this.options.agentFindingsBySlug?.[agent.slug];
    if (overrideFindings !== undefined) {
      return {
        agentSlug: agent.slug,
        findings: overrideFindings,
        modelUsed: agent.model,
        effortUsed: agent.effort ?? null,
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
        costEstimateUsd: 0.01,
        durationMs: 10,
      };
    }

    return createAgentResult(
      agent,
      signal.aborted || this.options.noFindings === true,
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
    for (const resolve of this.heldAgentResolvers.splice(0)) {
      resolve();
    }
  }

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

  async waitForRunningVerifier(): Promise<void> {
    await this.runningVerifierPromise;
  }

  resolveHeldVerifiers(): void {
    for (const resolve of this.heldVerifierResolvers.splice(0)) {
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
  private readonly dailyCapReservations = new Map<string, number>();
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
    // Only a specialist's estimate (agentId set) represents the "first agent
    // ran" milestone this option simulates — triage/verifier system-role
    // estimates (agentId null) must not trip it early.
    if (this.options.spendAfterFirstEstimate !== undefined && event.agentId !== null) {
      this.spendTodayEstimateValue = this.options.spendAfterFirstEstimate;
    }
    this.dailyCapReservations.delete(event.idempotencyKey);
  }

  async recordSandbox(event: SandboxCostInput): Promise<void> {
    if (this.idempotencyKeys.has(event.idempotencyKey)) return;
    this.idempotencyKeys.add(event.idempotencyKey);
    this.sandboxCostEvents.push(event);
  }

  // Not part of `CostPort` — per-run cost reconciliation was removed (#215).
  // Kept as a tripwire: it always throws, so if a regression reintroduces a
  // call to it at the review-workflow boundary, the test fails loudly
  // instead of silently recording another reconciliation.
  async reconcile(reviewRunId: string): Promise<void> {
    this.reconcileCalls.push(reviewRunId);
    throw new Error(
      'cost.reconcile must not be called: per-run reconciliation was removed (#215).',
    );
  }

  async enforceDailyCap(
    userId: number,
    reservation?: { idempotencyKey: string; amountUsd: number },
  ): Promise<DailyCapDecision> {
    this.enforceDailyCapCalls.push(userId);
    const capUsd = 10;
    const reservedUsd =
      reservation === undefined
        ? 0
        : [...this.dailyCapReservations.entries()]
            .filter(([idempotencyKey]) => idempotencyKey !== reservation.idempotencyKey)
            .reduce((total, [, amountUsd]) => total + amountUsd, 0);
    const spendUsd = this.spendTodayEstimateValue + reservedUsd;
    const allowed =
      reservation === undefined ? spendUsd < capUsd : spendUsd + reservation.amountUsd <= capUsd;
    if (
      allowed &&
      reservation !== undefined &&
      !this.dailyCapReservations.has(reservation.idempotencyKey)
    ) {
      this.dailyCapReservations.set(reservation.idempotencyKey, reservation.amountUsd);
    }
    return {
      allowed,
      capUsd,
      spendUsd,
      remainingUsd: Math.max(0, capUsd - spendUsd),
    };
  }

  setSpendTodayEstimate(value: number): void {
    this.spendTodayEstimateValue = value;
  }
}

function createSystemRoleAgentResult(
  agent: AgentSpec,
  extra: Pick<AgentResult, 'triage' | 'verification'> &
    Partial<Pick<AgentResult, 'costEstimateUsd'>>,
): AgentResult {
  return {
    agentSlug: agent.slug,
    findings: [],
    modelUsed: agent.model,
    effortUsed: agent.effort ?? null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    costEstimateUsd: 0,
    durationMs: 1,
    ...extra,
  };
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
