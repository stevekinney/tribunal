import { createHash, createHmac } from 'node:crypto';
import { toAgentDefinition } from '@tribunal/agents/definitions';
import {
  anchorFindings,
  compareFindingsForPosting,
  computeCanonicalFindingFingerprint,
  deduplicateFindings,
  mergeNearDuplicateFindings,
} from '@tribunal/agents/findings';
import { sandboxCost } from '@tribunal/cost/pricing';
import { redactRuntimeRecord } from '@tribunal/review-core/redaction';
import type {
  AgentEvent,
  AgentResult,
  AgentRunRole,
  AgentSpec,
  CheckRunPatch,
  CostPort,
  DiffContext,
  Finding,
  GitHubPort,
  RepoRef,
  ReviewPayload,
  SandboxPort,
} from '@tribunal/review-core';
import {
  createAgentRunId,
  createAgentReviewIdempotencyKey,
  createLlmEstimateIdempotencyKey,
  createPullRequestSandboxKey,
  createPullRequestWorkflowId,
  createReviewRunId,
  createReviewRunIdempotencyKey,
  createRunCapabilityToken,
  createTriageAgentRunId,
  createVerifierAgentRunId,
} from './identifiers';

type RepositoryExecutionContext = RepoRef & { installationId: number };
type AgentExecutionSpec = AgentSpec & {
  agentRunId: string;
};
type ReviewLookupGitHubPort = GitHubPort & {
  findPostedReview(
    repository: RepoRef,
    pullRequestNumber: number,
    reviewMarker: string,
  ): Promise<{ comments: number } | undefined>;
};

export type ReviewIntentKind = 'start' | 'commit_pushed' | 'pr_closed' | 'manual';

export type PullRequestReviewTrigger = 'opened' | 'synchronize' | 'reopened' | 'manual';

/**
 * `advisory` (default): findings never block merges — Check Run conclusion is
 * `success`/`neutral`. `gating`: findings at or above `error` severity produce
 * `failure`, letting a repo admin mark the check required.
 */
export type CheckConclusionMode = 'advisory' | 'gating';

export type PullRequestReviewInput = {
  userId: number;
  repositoryId: number;
  installationId: number;
  repository: RepoRef;
  pullRequestNumber: number;
  headSha: string;
  trigger: PullRequestReviewTrigger;
  agents: AgentSpec[];
  ignoreGlobs: string[];
  /** Check Run created at webhook-intent time (T-1); the engine PATCHes this instead of creating its own. */
  checkRunId?: number;
  /** Defaults to `advisory` when not supplied (e.g. tests, pre-T-4 intents). */
  checkConclusionMode?: CheckConclusionMode;
};

export type ReviewIntent = {
  id: string;
  deliveryId: string;
  kind: ReviewIntentKind;
  pullRequest: PullRequestReviewInput;
  prState?: 'merged' | 'closed';
  createdAt: Date;
};

export type ClaimedReviewIntent = ReviewIntent & {
  claimedAt: Date;
};

export type ReviewIntentPort = {
  claimNextReviewIntent(now: Date): Promise<ClaimedReviewIntent | null>;
  markReviewIntentProcessed(intentId: string, claimedAt: Date, now: Date): Promise<boolean>;
  markReviewIntentFailed(
    intentId: string,
    claimedAt: Date,
    now: Date,
    error: unknown,
  ): Promise<void>;
};

export type ReviewWorkflowConfiguration = {
  sandboxImage: string;
  proxyUrl: string;
  proxySigningKey: string;
  runTokenTtlSeconds: number;
  idleSuspendSeconds: number;
  defaultModel: Exclude<AgentSpec['model'], 'inherit'>;
};

const SANDBOX_RESOURCES = { cpus: 2, memoryMb: 4096, storageMb: 20_480 };

export type ReviewRunStatus =
  | 'queued'
  | 'running'
  | 'posted'
  | 'superseded'
  | 'failed'
  | 'cancelled'
  | 'quota_blocked';

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AgentRunStoppedReason = NonNullable<AgentResult['stopped']>;

export type ReviewRunRecord = {
  id: string;
  idempotencyKey: string;
  workflowId: string;
  userId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  previousHeadSha?: string;
  trigger: PullRequestReviewTrigger;
  status: ReviewRunStatus;
  sandboxId: string;
  checkRunId?: number;
  /** Hash of the reviewed diff's content, for "diff unchanged since last review" skip detection. */
  patchId?: string;
  commentsPosted: number;
  reviewPostClaimedAt?: Date;
  costEstimateUsd: number;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
};

export type StopReviewRunResult = {
  stopped: boolean;
};

export type AgentRunRecord = {
  id: string;
  idempotencyKey: string;
  reviewRunId: string;
  userId: number;
  /** `null` for `triage`/`verifier` runs, which have no user-configured `agent` row. */
  agentId: string | null;
  role: AgentRunRole;
  status: AgentRunStatus;
  findingsCount: number;
  costEstimateUsd: number;
  modelUsed?: string;
  effortUsed?: AgentResult['effortUsed'];
  usage?: AgentResult['usage'];
  durationMs?: number;
  stoppedReason?: AgentRunStoppedReason;
  error?: string;
};

export type FindingVerificationStatus = 'pending' | 'verified' | 'rejected';

export type FindingRecord = Finding & {
  id: string;
  userId: number;
  agentRunId: string;
  anchored: boolean;
  githubCommentId?: number;
  fingerprint: string;
  verificationStatus: FindingVerificationStatus;
  verificationNote?: string;
  verifierAgentRunId?: string;
};

export type PullRequestSupervisorSnapshot = {
  workflowId: string;
  repositoryId: number;
  pullRequestNumber: number;
  sandboxId: string;
  headSha: string;
  activeRunId?: string;
  reviewedHeadShas: string[];
  status: 'running' | 'closed';
};

type AgentExecution = {
  agentRunId: string;
  controller: AbortController;
  stopReason: NonNullable<AgentResult['stopped']>;
};

type SupervisorState = PullRequestSupervisorSnapshot & {
  input: PullRequestReviewInput;
  checkRunId?: number;
  activeAgents: Map<string, AgentExecution>;
  runPromises: Map<string, Promise<ReviewRunRecord>>;
};

export type DurableReviewWorkflowState = {
  postedReviewRunIds?: string[];
  reconciledReviewRunIds?: string[];
  terminatedSandboxIds?: string[];
};

export type ReviewWorkflowPorts = {
  github: ReviewLookupGitHubPort;
  sandbox: SandboxPort;
  cost: CostPort;
  intents: ReviewIntentPort;
  state?: ReviewWorkflowStatePort;
};

export type PullRequestWorkflowState = {
  reviewRuns: ReviewRunRecord[];
  agentRuns: AgentRunRecord[];
};

export type ReviewPostClaimResult =
  | { status: 'claimed'; claimedAt: Date }
  | { status: 'already_posted'; commentsPosted: number }
  | { status: 'claimed_by_other'; claimedAt?: Date };

export type ReviewWorkflowStatePort = {
  loadPullRequestState(input: PullRequestReviewInput): Promise<PullRequestWorkflowState>;
  upsertReviewRun(run: ReviewRunRecord): Promise<void>;
  upsertAgentRun(run: AgentRunRecord): Promise<void>;
  upsertAgentEvent?(event: AgentEvent): Promise<void>;
  upsertFinding?(finding: FindingRecord): Promise<void>;
  claimReviewPost(reviewRunId: string, now: Date): Promise<ReviewPostClaimResult>;
  refreshReviewPostClaim(
    reviewRunId: string,
    claimedAt: Date,
    now: Date,
  ): Promise<Date | undefined>;
  clearReviewPostClaim(reviewRunId: string, claimedAt: Date): Promise<boolean>;
  ownsReviewPostClaim(reviewRunId: string, claimedAt: Date): Promise<boolean>;
};

class ReviewPostAlreadyClaimedError extends Error {
  constructor(reviewRunId: string) {
    super(`Review post is already claimed for ${reviewRunId}.`);
    this.name = 'ReviewPostAlreadyClaimedError';
  }
}

export function isReviewPostAlreadyClaimedError(error: unknown): boolean {
  if (error instanceof ReviewPostAlreadyClaimedError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ReviewPostAlreadyClaimedError' ||
    error.message.startsWith('Review post is already claimed for ')
  );
}

const staleReviewPostClaimMilliseconds = 5 * 60 * 1000;

export type ReviewWorkflowSnapshot = {
  supervisors: PullRequestSupervisorSnapshot[];
  reviewRuns: ReviewRunRecord[];
  agentRuns: AgentRunRecord[];
  agentEvents: AgentEvent[];
  durableState: DurableReviewWorkflowState;
};

export class ReviewWorkflowEngine {
  readonly workflowNames = {
    pullRequestSupervisor: 'review.pr',
    reviewRun: 'review.run',
    agentReview: 'agent.review',
    sandboxReaper: 'sandbox.reaper',
  } as const;

  private readonly supervisors = new Map<string, SupervisorState>();
  private readonly supervisorPromises = new Map<string, Promise<SupervisorState>>();
  private readonly reviewRuns = new Map<string, ReviewRunRecord>();
  private readonly agentRuns = new Map<string, AgentRunRecord>();
  private readonly agentEvents: AgentEvent[] = [];
  private readonly agentEventWrites: Promise<void>[] = [];
  private readonly postedReviewRunIds: Set<string>;
  private readonly reconciledReviewRunIds: Set<string>;
  private readonly terminatedSandboxIds: Set<string>;

  constructor(
    private readonly ports: ReviewWorkflowPorts,
    private readonly configuration: ReviewWorkflowConfiguration,
    private readonly now: () => Date = () => new Date(),
    durableState: DurableReviewWorkflowState = {},
  ) {
    this.postedReviewRunIds = new Set(durableState.postedReviewRunIds ?? []);
    this.reconciledReviewRunIds = new Set(durableState.reconciledReviewRunIds ?? []);
    this.terminatedSandboxIds = new Set(durableState.terminatedSandboxIds ?? []);
  }

  async claimReviewIntents(limit = 5): Promise<number> {
    let processed = 0;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      const intent = await this.ports.intents.claimNextReviewIntent(this.now());
      if (intent === null) return processed;

      try {
        await this.processClaimedReviewIntent(intent);
        const markedProcessed = await this.ports.intents.markReviewIntentProcessed(
          intent.id,
          intent.claimedAt,
          this.now(),
        );
        if (markedProcessed) processed += 1;
      } catch (error) {
        if (isReviewPostAlreadyClaimedError(error)) continue;
        await this.ports.intents.markReviewIntentFailed(
          intent.id,
          intent.claimedAt,
          this.now(),
          error,
        );
      }
    }

    return processed;
  }

  async startPullRequestReview(input: PullRequestReviewInput): Promise<ReviewRunRecord> {
    const supervisor = await this.ensureSupervisor(input);
    if (supervisor.status === 'closed') {
      throw new Error('Cannot start a review for a closed pull request supervisor.');
    }

    // A manual re-review targets a head sha the supervisor already reviewed,
    // so its Check Run may still be sitting in a prior `completed` state
    // (conclusion and all). PATCH it back to `in_progress` before a genuinely
    // new run starts so GitHub's Checks tab — and required-check gating —
    // reflects the in-flight re-review instead of a stale conclusion. Skip
    // when this exact run id will be deduplicated/reused (repeat click,
    // already in flight) so we never disturb an unrelated run's check state.
    if (input.trigger === 'manual' && supervisor.checkRunId !== undefined) {
      const runId = createReviewRunId({
        repositoryId: input.repositoryId,
        pullRequestNumber: input.pullRequestNumber,
        headSha: input.headSha,
        trigger: input.trigger,
      });
      const isAlreadyInFlight = supervisor.runPromises.has(runId);
      const existingRun = this.reviewRuns.get(runId);
      if (!isAlreadyInFlight && existingRun === undefined) {
        await this.updateCheckRun(input, supervisor.checkRunId, {
          status: 'in_progress',
          startedAt: this.now().toISOString(),
        });
      }
    }

    return this.startReviewRun(supervisor, input.headSha, input.trigger);
  }

  async signalCommitPushed(input: PullRequestReviewInput): Promise<ReviewRunRecord> {
    const supervisor = await this.ensureSupervisor(input);
    if (supervisor.headSha === input.headSha) {
      const existingRunId = createReviewRunId({
        repositoryId: input.repositoryId,
        pullRequestNumber: input.pullRequestNumber,
        headSha: input.headSha,
        trigger: 'synchronize',
      });
      const existingPromise = supervisor.runPromises.get(existingRunId);
      if (existingPromise !== undefined) return existingPromise;

      const existingRun = this.reviewRuns.get(existingRunId);
      if (existingRun !== undefined && isReusableReviewRun(existingRun)) return existingRun;
    }

    const isNewHead = supervisor.headSha !== input.headSha;
    const previousHeadSha = supervisor.reviewedHeadShas.at(-1) ?? supervisor.headSha;
    await this.stopActiveAgents(supervisor, 'superseded');
    const activeRun = supervisor.activeRunId
      ? this.reviewRuns.get(supervisor.activeRunId)
      : undefined;
    if (activeRun?.status === 'running') {
      activeRun.status = 'superseded';
      activeRun.finishedAt = this.now();
      await this.persistReviewRun(activeRun);
    }

    supervisor.input = input;
    supervisor.headSha = input.headSha;
    // Every push gets its own Check Run (T-1); adopt this head's id so
    // subsequent PATCHes target the current run, not the superseded one. Only
    // re-resolve on an actual head change — a retry of the same head reuses
    // the supervisor's existing check run instead of creating a new one.
    if (isNewHead) {
      supervisor.checkRunId = await this.ensureInProgressCheckRun(input);
    }

    return this.startReviewRun(supervisor, input.headSha, 'synchronize', previousHeadSha);
  }

  async signalPullRequestClosed(
    input: PullRequestReviewInput,
    prState: 'merged' | 'closed',
  ): Promise<void> {
    const workflowId = createPullRequestWorkflowId({
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
    });
    const supervisor =
      this.supervisors.get(workflowId) ?? (await this.hydrateSupervisor(workflowId, input));
    if (supervisor === undefined || supervisor.status === 'closed') return;

    await this.stopActiveAgents(supervisor, 'pr_closed');
    const activeRun = supervisor.activeRunId
      ? this.reviewRuns.get(supervisor.activeRunId)
      : undefined;
    if (activeRun?.status === 'running') {
      activeRun.status = 'cancelled';
      activeRun.finishedAt = this.now();
      await this.persistReviewRun(activeRun);
    }

    if (supervisor.checkRunId !== undefined) {
      await this.updateCheckRun(input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: prState === 'merged' ? 'success' : 'cancelled',
        output: {
          title: 'Tribunal review stopped',
          summary: `Pull request ${prState}; stopped in-flight review work.`,
        },
      });
    }

    await this.terminateSandboxOnce(supervisor.sandboxId);
    supervisor.status = 'closed';
    supervisor.activeRunId = undefined;
  }

  async stopAgent(
    reviewRunId: string,
    agentId: string,
    reason: NonNullable<AgentResult['stopped']>,
  ): Promise<StopReviewRunResult> {
    const agentRunId = `arun:${reviewRunId}:${agentId}`;
    for (const supervisor of this.supervisors.values()) {
      const execution = supervisor.activeAgents.get(agentRunId);
      if (execution !== undefined) {
        execution.stopReason = reason;
        execution.controller.abort();
        await this.ports.sandbox.stop(supervisor.sandboxId, agentRunId);
        return { stopped: true };
      }
    }
    return { stopped: false };
  }

  async stopRun(
    reviewRunId: string,
    reason: NonNullable<AgentResult['stopped']> = 'timeout',
  ): Promise<StopReviewRunResult> {
    for (const supervisor of this.supervisors.values()) {
      if (supervisor.activeRunId !== reviewRunId) continue;

      const run = this.reviewRuns.get(reviewRunId);
      if (run?.status !== 'running') {
        supervisor.activeRunId = undefined;
        return { stopped: false };
      }

      await this.stopActiveAgents(supervisor, reason);
      run.status = 'cancelled';
      run.finishedAt = this.now();
      await this.persistReviewRun(run);
      await this.updateCheckRun(supervisor.input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'cancelled',
        output: {
          title: 'Tribunal review stopped',
          summary: 'Review run stopped by operator.',
        },
      });
      supervisor.activeRunId = undefined;
      return { stopped: true };
    }
    return { stopped: false };
  }

  async reapClosedPullRequestSandboxes(
    openPullRequests: Array<{ repositoryId: number; pullRequestNumber: number }>,
  ): Promise<string[]> {
    const openSandboxKeys = new Set(
      openPullRequests.map((pullRequest) => createPullRequestSandboxKey(pullRequest)),
    );
    const terminatedSandboxIds: string[] = [];

    for (const supervisor of this.supervisors.values()) {
      const sandboxKey = createPullRequestSandboxKey(supervisor);
      if (supervisor.status === 'closed' || !openSandboxKeys.has(sandboxKey)) {
        const terminated = await this.terminateSandboxOnce(supervisor.sandboxId);
        if (terminated) terminatedSandboxIds.push(supervisor.sandboxId);
        supervisor.status = 'closed';
      }
    }

    return terminatedSandboxIds.sort();
  }

  snapshot(): ReviewWorkflowSnapshot {
    const supervisors = [...this.supervisors.values()]
      .map(toSupervisorSnapshot)
      .sort(compareSupervisorSnapshots);

    return {
      supervisors,
      reviewRuns: [...this.reviewRuns.values()].sort(compareReviewRuns),
      agentRuns: [...this.agentRuns.values()].sort(compareAgentRuns),
      agentEvents: [...this.agentEvents].sort((left, right) => left.seq - right.seq),
      durableState: {
        postedReviewRunIds: [...this.postedReviewRunIds].sort(),
        reconciledReviewRunIds: [...this.reconciledReviewRunIds].sort(),
        terminatedSandboxIds: [...this.terminatedSandboxIds].sort(),
      },
    };
  }

  async processClaimedReviewIntent(intent: ClaimedReviewIntent): Promise<void> {
    if (intent.kind === 'start' || intent.kind === 'manual') {
      // A repeat "Re-review" click on an already-reviewed sha resolves to the
      // same review_run id (createReviewRunId keys on headSha + trigger, and
      // 'manual' intents always map to the 'manual' trigger) — startReviewRun
      // already deduplicates on that id via isReusableReviewRun, returning
      // the existing posted run instead of re-running agents. No upsert or
      // generation column needed: the run-id-level idempotency the engine
      // already has for every trigger covers this case too.
      await this.startPullRequestReview(intent.pullRequest);
      return;
    }

    if (intent.kind === 'commit_pushed') {
      await this.signalCommitPushed(intent.pullRequest);
      return;
    }

    await this.signalPullRequestClosed(intent.pullRequest, intent.prState ?? 'closed');
  }

  private async ensureSupervisor(input: PullRequestReviewInput): Promise<SupervisorState> {
    const workflowId = createPullRequestWorkflowId({
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
    });
    const existingSupervisor = this.supervisors.get(workflowId);
    if (existingSupervisor !== undefined) return existingSupervisor;
    const existingPromise = this.supervisorPromises.get(workflowId);
    if (existingPromise !== undefined) return existingPromise;

    const supervisorPromise = this.createSupervisor(workflowId, input).finally(() => {
      this.supervisorPromises.delete(workflowId);
    });
    this.supervisorPromises.set(workflowId, supervisorPromise);
    return supervisorPromise;
  }

  private async createSupervisor(
    workflowId: string,
    input: PullRequestReviewInput,
  ): Promise<SupervisorState> {
    const hydratedSupervisor = await this.hydrateSupervisor(workflowId, input);
    if (hydratedSupervisor !== undefined) return hydratedSupervisor;

    const sandboxKey = createPullRequestSandboxKey({
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
    });
    const { sandboxId } = await this.ports.sandbox.ensure(sandboxKey, {
      image: this.configuration.sandboxImage,
      proxyUrl: this.configuration.proxyUrl,
      idleSuspendSeconds: this.configuration.idleSuspendSeconds,
    });
    const checkRunId = await this.ensureInProgressCheckRun(input);
    const supervisor: SupervisorState = {
      workflowId,
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
      sandboxId,
      headSha: input.headSha,
      activeRunId: undefined,
      reviewedHeadShas: [],
      status: 'running',
      input,
      checkRunId,
      activeAgents: new Map(),
      runPromises: new Map(),
    };

    this.supervisors.set(workflowId, supervisor);
    return supervisor;
  }

  /**
   * Bind the "in progress" Check Run to this input's head_sha, not the
   * supervisor's cached one. The supervisor is keyed by (repository, PR) and
   * survives across pushes, but T-1 creates a fresh Check Run per delivery
   * (one per head_sha) — so every push must re-resolve which Check Run id is
   * current, or later PATCHes silently target a stale, already-superseded run.
   *
   * PATCHes the Check Run the web webhook handler already created at intent
   * time (T-1) when `input.checkRunId` is present. Falls back to creating one
   * here only when the intent predates T-1 or web-side creation failed.
   */
  private async ensureInProgressCheckRun(input: PullRequestReviewInput): Promise<number> {
    if (input.checkRunId !== undefined) {
      await this.ports.github.updateCheckRun(repositoryExecutionContext(input), input.checkRunId, {
        status: 'in_progress',
        startedAt: this.now().toISOString(),
      });
      return input.checkRunId;
    }

    console.warn('[review-workflow] No intent-supplied Check Run id; falling back to creation.', {
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
    });
    const { checkRunId } = await this.ports.github.createCheckRun(
      repositoryExecutionContext(input),
      input.headSha,
    );
    return checkRunId;
  }

  private async startReviewRun(
    supervisor: SupervisorState,
    headSha: string,
    trigger: PullRequestReviewTrigger,
    previousHeadSha?: string,
  ): Promise<ReviewRunRecord> {
    const runId = createReviewRunId({
      repositoryId: supervisor.repositoryId,
      pullRequestNumber: supervisor.pullRequestNumber,
      headSha,
      trigger,
    });
    const existingPromise = supervisor.runPromises.get(runId);
    if (existingPromise !== undefined) return existingPromise;

    const existingRun = this.reviewRuns.get(runId);
    if (existingRun !== undefined && isReusableReviewRun(existingRun)) return existingRun;

    const runPromise = this.executeReviewRun(supervisor, runId, headSha, trigger, previousHeadSha)
      .catch((error) => {
        supervisor.runPromises.delete(runId);
        if (error instanceof ReviewPostAlreadyClaimedError) throw error;

        const run = this.reviewRuns.get(runId);
        if (run !== undefined && (run.status === 'posted' || run.commentsPosted > 0)) {
          return this.persistReviewRun(run).then(() => {
            throw error;
          });
        }
        if (run !== undefined) {
          run.status = 'failed';
          run.error = error instanceof Error ? error.message : 'Review run failed.';
          run.finishedAt = this.now();
        }
        return this.persistReviewRun(run).then(async () => {
          await this.updateCheckRun(supervisor.input, supervisor.checkRunId, {
            status: 'completed',
            // Terminal engine failure (§1 conclusion table): the run never
            // posted, so there is nothing advisory to soften — `failure`.
            conclusion: 'failure',
            output: {
              title: 'Tribunal review failed',
              summary: `Review run failed during setup: ${run?.error ?? 'unknown error'}. See Tribunal logs for details.`,
            },
          });
          throw error;
        });
      })
      .finally(() => {
        const run = this.reviewRuns.get(runId);
        if (run !== undefined && run.status !== 'running') {
          supervisor.runPromises.delete(runId);
          if (supervisor.activeRunId === runId) supervisor.activeRunId = undefined;
        }
      });
    supervisor.runPromises.set(runId, runPromise);
    return runPromise;
  }

  private async executeReviewRun(
    supervisor: SupervisorState,
    runId: string,
    headSha: string,
    trigger: PullRequestReviewTrigger,
    previousHeadSha?: string,
  ): Promise<ReviewRunRecord> {
    const input = supervisor.input;
    const existingRun = this.reviewRuns.get(runId);
    const reviewRun: ReviewRunRecord = {
      id: runId,
      idempotencyKey: createReviewRunIdempotencyKey({
        repositoryId: input.repositoryId,
        pullRequestNumber: input.pullRequestNumber,
        headSha,
        trigger,
      }),
      workflowId: supervisor.workflowId,
      userId: input.userId,
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
      headSha,
      previousHeadSha,
      trigger,
      status: 'running',
      sandboxId: existingRun?.sandboxId ?? supervisor.sandboxId,
      checkRunId: existingRun?.checkRunId ?? supervisor.checkRunId,
      commentsPosted: existingRun?.commentsPosted ?? 0,
      reviewPostClaimedAt: existingRun?.reviewPostClaimedAt,
      costEstimateUsd: existingRun?.costEstimateUsd ?? 0,
      startedAt: existingRun?.startedAt ?? this.now(),
    };
    this.reviewRuns.set(runId, reviewRun);
    supervisor.activeRunId = runId;
    await this.persistReviewRun(reviewRun);

    const dailyCapDecision = await this.ports.cost.enforceDailyCap(input.userId);
    if (!dailyCapDecision.allowed) {
      reviewRun.status = 'quota_blocked';
      reviewRun.finishedAt = this.now();
      await this.persistReviewRun(reviewRun);
      await this.updateCheckRun(input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'neutral',
        output: {
          title: 'Tribunal review quota blocked',
          summary: 'Daily review cost cap reached.',
        },
      });
      return reviewRun;
    }

    const runToken = createRunCapabilityToken({
      reviewRunId: runId,
      userId: input.userId,
      repositoryId: input.repositoryId,
      installationId: input.installationId,
      repository: input.repository,
      expiresAt: new Date(this.now().getTime() + this.configuration.runTokenTtlSeconds * 1000),
      signingKey: this.configuration.proxySigningKey,
    });
    await this.ports.sandbox.update(supervisor.sandboxId, input.repository, headSha, runToken);
    const diffContext = await this.ports.github.getDiffContext(
      repositoryExecutionContext(input),
      input.pullRequestNumber,
      headSha,
      previousHeadSha,
    );
    const patchId = computePatchId(diffContext);
    reviewRun.patchId = patchId;
    if (
      this.findLastPostedPatchId(input.repositoryId, input.pullRequestNumber, runId) === patchId
    ) {
      reviewRun.status = 'posted';
      reviewRun.finishedAt = this.now();
      supervisor.reviewedHeadShas.push(headSha);
      await this.persistReviewRun(reviewRun);
      await this.updateCheckRun(input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review skipped',
          summary: 'Diff unchanged since the last review.',
        },
      });
      return reviewRun;
    }
    if (shouldSkipIgnoredDiff(diffContext, [...DEFAULT_IGNORE_GLOBS, ...input.ignoreGlobs])) {
      reviewRun.status = 'posted';
      reviewRun.finishedAt = this.now();
      supervisor.reviewedHeadShas.push(headSha);
      await this.persistReviewRun(reviewRun);
      await this.updateCheckRun(input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review skipped',
          summary: 'Only ignored paths changed.',
        },
      });
      return reviewRun;
    }
    const enabledAgents = input.agents.filter((agent) => agent.enabled);
    const triageResult = await this.runTriageAgent(
      supervisor,
      reviewRun,
      enabledAgents.map((agent) => agent.slug),
      runToken,
      diffContext,
    );
    reviewRun.costEstimateUsd += triageResult.costEstimateUsd;
    if (triageResult.triage?.skip === true) {
      reviewRun.status = 'posted';
      reviewRun.finishedAt = this.now();
      supervisor.reviewedHeadShas.push(headSha);
      await this.persistReviewRun(reviewRun);
      await this.updateCheckRun(input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal review skipped',
          summary: `Triage found nothing reviewable: ${triageResult.triage.reason || '(no reason given)'}`,
        },
      });
      return reviewRun;
    }
    const { results: agentResults, quotaBlocked } = await this.runAgents(
      supervisor,
      reviewRun,
      enabledAgents,
      runToken,
      diffContext,
    );

    if (isStoppedReviewRun(reviewRun)) return reviewRun;
    if (quotaBlocked) {
      reviewRun.costEstimateUsd =
        triageResult.costEstimateUsd +
        agentResults.reduce((total, result) => total + result.costEstimateUsd, 0);
      reviewRun.status = 'quota_blocked';
      reviewRun.finishedAt = this.now();
      await this.persistReviewRun(reviewRun);
      await this.updateCheckRun(input, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'neutral',
        output: {
          title: 'Tribunal review quota blocked',
          summary: 'Daily review cost cap reached before all enabled agents could run.',
        },
      });
      return reviewRun;
    }

    const deduplicatedAgentResults = deduplicateAgentResultFindings(agentResults);
    const agentRunIdBySlug = new Map(
      enabledAgents.map((agent) => [agent.slug, createAgentRunId(reviewRun.id, agent)]),
    );
    const verificationCandidates = deduplicatedAgentResults.flatMap((result) => {
      const agentRunId = agentRunIdBySlug.get(result.agentSlug);
      if (agentRunId === undefined) return [];
      return result.findings.map((finding) => ({ agentRunId, finding }));
    });
    const { verifiedFindings, costEstimateUsd: verificationCostEstimateUsd } =
      await this.runVerificationStage(
        supervisor,
        reviewRun,
        diffContext,
        runToken,
        verificationCandidates,
      );
    reviewRun.costEstimateUsd += verificationCostEstimateUsd;
    // A supersede/abort can arrive while verifiers are still in flight; an
    // in-flight verifier can resolve just after the signal (it isn't wired to
    // the AbortController the way specialist processes are). Re-check here so
    // a superseded run never reaches the single posting join — otherwise the
    // stale run and its successor could both post a review for the same PR.
    if (isStoppedReviewRun(reviewRun)) return reviewRun;
    const findings = [...mergeNearDuplicateFindings(verifiedFindings)].sort(
      compareFindingsForPosting,
    );
    await this.persistMergedFingerprints(reviewRun, findings, verificationCandidates);
    const reviewPayload = buildReviewPayload(headSha, diffContext, findings);
    if (reviewPayload.comments.length > 0 && !this.postedReviewRunIds.has(reviewRun.id)) {
      const claimResult = await this.claimReviewPost(reviewRun);
      let ownedClaimedAt: Date | undefined;
      if (claimResult.status === 'already_posted') {
        reviewRun.commentsPosted = claimResult.commentsPosted;
      } else if (claimResult.status === 'claimed_by_other') {
        let posted: { comments: number } | undefined;
        try {
          posted = await this.findPostedReview(input, reviewRun.id);
        } catch {
          throw new ReviewPostAlreadyClaimedError(reviewRun.id);
        }
        if (posted !== undefined) {
          reviewRun.commentsPosted = posted.comments;
          reviewRun.reviewPostClaimedAt = undefined;
          this.postedReviewRunIds.add(reviewRun.id);
          await this.persistReviewRun(reviewRun);
        } else if (
          claimResult.claimedAt !== undefined &&
          this.isStaleReviewPostClaim(claimResult.claimedAt)
        ) {
          const cleared = await this.ports.state?.clearReviewPostClaim(
            reviewRun.id,
            claimResult.claimedAt,
          );
          if (cleared !== true) throw new ReviewPostAlreadyClaimedError(reviewRun.id);
          reviewRun.reviewPostClaimedAt = undefined;
          const retryClaimResult = await this.claimReviewPost(reviewRun);
          if (retryClaimResult.status === 'already_posted') {
            reviewRun.commentsPosted = retryClaimResult.commentsPosted;
          } else if (retryClaimResult.status === 'claimed') {
            ownedClaimedAt = retryClaimResult.claimedAt;
          } else {
            throw new ReviewPostAlreadyClaimedError(reviewRun.id);
          }
        } else {
          throw new ReviewPostAlreadyClaimedError(reviewRun.id);
        }
      } else if (claimResult.status === 'claimed') {
        ownedClaimedAt = claimResult.claimedAt;
      }

      if (ownedClaimedAt !== undefined) {
        reviewRun.reviewPostClaimedAt = ownedClaimedAt;
        await this.persistReviewRun(reviewRun);

        let attemptedReviewPost = false;
        try {
          const stillOwnsClaim = await this.ownsReviewPostClaim(reviewRun.id, ownedClaimedAt);
          if (!stillOwnsClaim) throw new ReviewPostAlreadyClaimedError(reviewRun.id);
          const posted = await this.findPostedReview(input, reviewRun.id);
          if (posted !== undefined) {
            reviewRun.commentsPosted = posted.comments;
            this.postedReviewRunIds.add(reviewRun.id);
            await this.persistReviewRun(reviewRun);
          } else {
            const stillOwnsClaimAfterLookup = await this.ownsReviewPostClaim(
              reviewRun.id,
              ownedClaimedAt,
            );
            if (!stillOwnsClaimAfterLookup) throw new ReviewPostAlreadyClaimedError(reviewRun.id);
            const refreshedClaimedAt = await this.refreshReviewPostClaim(
              reviewRun.id,
              ownedClaimedAt,
            );
            if (refreshedClaimedAt === undefined) {
              throw new ReviewPostAlreadyClaimedError(reviewRun.id);
            }
            ownedClaimedAt = refreshedClaimedAt;
            reviewRun.reviewPostClaimedAt = refreshedClaimedAt;
            await this.persistReviewRun(reviewRun);
            attemptedReviewPost = true;
            const posted = await this.ports.github.postReview(
              repositoryExecutionContext(input),
              input.pullRequestNumber,
              withReviewRunMarker(
                reviewPayload,
                createSignedReviewRunMarker(reviewRun.id, this.configuration.proxySigningKey),
              ),
            );
            reviewRun.commentsPosted = posted.comments;
          }
        } catch (error) {
          if (!attemptedReviewPost) {
            reviewRun.reviewPostClaimedAt = undefined;
            await this.ports.state?.clearReviewPostClaim(reviewRun.id, ownedClaimedAt);
            await this.persistReviewRun(reviewRun);
            throw error;
          }

          const posted = await this.findPostedReview(input, reviewRun.id);
          if (posted !== undefined) {
            reviewRun.commentsPosted = posted.comments;
            this.postedReviewRunIds.add(reviewRun.id);
          }
          await this.persistReviewRun(reviewRun);
          if (posted === undefined) throw error;
        }
        reviewRun.reviewPostClaimedAt = undefined;
        this.postedReviewRunIds.add(reviewRun.id);
        await this.persistReviewRun(reviewRun);
      }
    }
    if (
      findings.length > 0 &&
      (reviewRun.commentsPosted > 0 || this.postedReviewRunIds.has(reviewRun.id))
    ) {
      this.postedReviewRunIds.add(reviewRun.id);
    }
    if (isStoppedReviewRun(reviewRun)) {
      await this.persistReviewRun(reviewRun);
      return reviewRun;
    }
    reviewRun.costEstimateUsd =
      triageResult.costEstimateUsd +
      verificationCostEstimateUsd +
      agentResults.reduce((total, result) => total + result.costEstimateUsd, 0);
    reviewRun.status = 'posted';
    reviewRun.finishedAt = this.now();
    supervisor.reviewedHeadShas.push(headSha);
    await this.persistReviewRun(reviewRun);

    const verifiedFingerprints = new Set(
      findings.map((finding) => computeCanonicalFindingFingerprint(finding)),
    );
    const verifiedAgentResults = deduplicatedAgentResults.map((result) => ({
      ...result,
      findings: result.findings.filter((finding) =>
        verifiedFingerprints.has(computeCanonicalFindingFingerprint(finding)),
      ),
    }));
    await this.updateCheckRun(
      input,
      supervisor.checkRunId,
      buildCompletedCheckRunPatch(
        verifiedAgentResults,
        diffContext,
        input.checkConclusionMode ?? 'advisory',
      ),
    );
    if (!this.reconciledReviewRunIds.has(reviewRun.id)) {
      await this.ports.cost.reconcile(reviewRun.id);
      this.reconciledReviewRunIds.add(reviewRun.id);
    }
    return reviewRun;
  }

  private async runAgents(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    agents: AgentSpec[],
    runToken: string,
    diffContext: DiffContext,
  ): Promise<{ results: AgentResult[]; quotaBlocked: boolean }> {
    const results: AgentResult[] = [];

    for (const agent of agents) {
      if (reviewRun.status === 'superseded' || reviewRun.status === 'cancelled') {
        return { results, quotaBlocked: false };
      }

      const dailyCapDecision = await this.ports.cost.enforceDailyCap(reviewRun.userId);
      if (!dailyCapDecision.allowed) {
        return { results, quotaBlocked: true };
      }

      results.push(await this.runAgentReview(supervisor, reviewRun, agent, runToken, diffContext));
    }

    return { results, quotaBlocked: false };
  }

  private async runAgentReview(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    agent: AgentSpec,
    runToken: string,
    diffContext: DiffContext,
  ): Promise<AgentResult> {
    const agentRunId = createAgentRunId(reviewRun.id, agent);
    const mappedAgent = toAgentDefinition(agent, this.configuration.defaultModel);
    const effectiveAgent: AgentSpec = {
      ...agent,
      model: mappedAgent.effectiveModel,
      effort: mappedAgent.effectiveEffort ?? undefined,
    };
    return this.executeSandboxAgent({
      supervisor,
      reviewRun,
      agentRunId,
      idempotencyKey: createAgentReviewIdempotencyKey(reviewRun.id, agent),
      role: 'specialist',
      agentIdForPersistence: agent.id,
      agentSpec: effectiveAgent,
      runToken,
      diffContext,
      sanitizeResult: (result) => sanitizeAgentResultFindings(result, diffContext),
    });
  }

  /**
   * Haiku triage stage: classifies the pull request, decides whether it is
   * worth reviewing at all, and flags risk surfaces. Persisted as an
   * `agent_run` with `role: 'triage'` and no `agentId` — triage has no
   * user-configured `agent` row.
   */
  private async runTriageAgent(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    availableAgentSlugs: string[],
    runToken: string,
    diffContext: DiffContext,
  ): Promise<AgentResult> {
    const agentRunId = createTriageAgentRunId(reviewRun.id);
    const agentSpec: AgentSpec = {
      id: 'triage',
      userId: reviewRun.userId,
      slug: 'triage',
      description: 'Tribunal triage agent',
      body: 'Classify the pull request and decide whether it needs specialist review.',
      model: 'haiku',
      effort: 'low',
      enabled: true,
      role: 'triage',
      availableAgentSlugs,
    };
    return this.executeSandboxAgent({
      supervisor,
      reviewRun,
      agentRunId,
      idempotencyKey: `triage:${reviewRun.id}`,
      role: 'triage',
      agentIdForPersistence: null,
      agentSpec,
      runToken,
      diffContext,
      sanitizeResult: (result) => result,
    });
  }

  /**
   * Haiku verification stage: one process per candidate finding, adversarial
   * "try to refute this" pass. Persisted as an `agent_run` with `role:
   * 'verifier'` and no `agentId`.
   */
  private async runVerifierAgent(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    finding: Finding,
    fingerprint: string,
    runToken: string,
    diffContext: DiffContext,
  ): Promise<AgentResult> {
    const agentRunId = createVerifierAgentRunId(reviewRun.id, fingerprint);
    const agentSpec: AgentSpec = {
      id: `verify:${fingerprint}`,
      userId: reviewRun.userId,
      slug: 'verifier',
      description: 'Tribunal verification agent',
      body: 'Try to refute this candidate finding. It survives only with a concrete file:line citation in actual source.',
      model: 'haiku',
      effort: 'low',
      enabled: true,
      role: 'verifier',
      findingToVerify: finding,
    };
    return this.executeSandboxAgent({
      supervisor,
      reviewRun,
      agentRunId,
      idempotencyKey: `verify:${reviewRun.id}:${fingerprint}`,
      role: 'verifier',
      agentIdForPersistence: null,
      agentSpec,
      runToken,
      diffContext,
      sanitizeResult: (result) => result,
    });
  }

  /**
   * Spawns one Haiku verifier per candidate finding, bounded to ~4 concurrent
   * sandbox processes (pipelined — no barrier on the slowest specialist beyond
   * this bound). Persists each finding's verification outcome; only findings
   * the verifier could not refute are returned for posting.
   */
  private async runVerificationStage(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    diffContext: DiffContext,
    runToken: string,
    candidates: Array<{ agentRunId: string; finding: Finding }>,
  ): Promise<{ verifiedFindings: Finding[]; costEstimateUsd: number }> {
    const verifiedFindings: Finding[] = [];
    let costEstimateUsd = 0;
    let cursor = 0;
    const concurrency = Math.min(4, candidates.length);

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= candidates.length) return;
        const candidate = candidates[index]!;
        const fingerprint = computeCanonicalFindingFingerprint(candidate.finding);
        const verifierResult = await this.runVerifierAgent(
          supervisor,
          reviewRun,
          candidate.finding,
          fingerprint,
          runToken,
          diffContext,
        );
        costEstimateUsd += verifierResult.costEstimateUsd;
        const verified = verifierResult.verification?.verified === true;
        await this.persistFinding({
          ...createFindingRecord(reviewRun.userId, candidate.agentRunId, candidate.finding),
          verificationStatus: verified ? 'verified' : 'rejected',
          verificationNote: verifierResult.verification?.note,
          verifierAgentRunId: createVerifierAgentRunId(reviewRun.id, fingerprint),
        });
        if (verified) verifiedFindings.push(candidate.finding);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return { verifiedFindings, costEstimateUsd };
  }

  /**
   * Patches the already-persisted `finding` rows for cross-agent dedup
   * survivors (T-11) with the fingerprints of the near-duplicates they
   * absorbed, so Phase 3's carried-forward dedup can match a re-reported
   * finding against either the surviving fingerprint or any merged-away one.
   * A no-op when `mergeNearDuplicateFindings` didn't merge anything.
   */
  private async persistMergedFingerprints(
    reviewRun: ReviewRunRecord,
    findings: readonly Finding[],
    verificationCandidates: ReadonlyArray<{ agentRunId: string; finding: Finding }>,
  ): Promise<void> {
    const survivors = findings.filter(
      (finding) =>
        finding.mergedFingerprints !== undefined && finding.mergedFingerprints.length > 0,
    );
    if (survivors.length === 0) return;

    await Promise.all(
      survivors.map((finding) => {
        const ownFingerprint = computeCanonicalFindingFingerprint(finding);
        const candidate = verificationCandidates.find(
          (entry) => computeCanonicalFindingFingerprint(entry.finding) === ownFingerprint,
        );
        if (candidate === undefined) return Promise.resolve();

        return this.persistFinding({
          ...createFindingRecord(reviewRun.userId, candidate.agentRunId, candidate.finding),
          verificationStatus: 'verified',
          mergedFingerprints: finding.mergedFingerprints,
        });
      }),
    );
  }

  private findLastPostedPatchId(
    repositoryId: number,
    pullRequestNumber: number,
    excludeRunId: string,
  ): string | undefined {
    const postedRuns = [...this.reviewRuns.values()].filter(
      (run) =>
        run.id !== excludeRunId &&
        run.repositoryId === repositoryId &&
        run.pullRequestNumber === pullRequestNumber &&
        run.status === 'posted' &&
        run.patchId !== undefined,
    );
    if (postedRuns.length === 0) return undefined;

    return postedRuns.sort(compareReviewRunsChronologically).at(-1)?.patchId;
  }

  private async executeSandboxAgent(input: {
    supervisor: SupervisorState;
    reviewRun: ReviewRunRecord;
    agentRunId: string;
    idempotencyKey: string;
    role: AgentRunRole;
    agentIdForPersistence: string | null;
    agentSpec: AgentSpec;
    runToken: string;
    diffContext: DiffContext;
    sanitizeResult: (result: AgentResult) => AgentResult;
  }): Promise<AgentResult> {
    const {
      supervisor,
      reviewRun,
      agentRunId,
      idempotencyKey,
      role,
      agentIdForPersistence,
      agentSpec,
      runToken,
      diffContext,
      sanitizeResult,
    } = input;
    const controller = new AbortController();
    const execution: AgentExecution = { agentRunId, controller, stopReason: 'superseded' };
    supervisor.activeAgents.set(agentRunId, execution);
    const agentRun: AgentRunRecord = {
      id: agentRunId,
      idempotencyKey,
      reviewRunId: reviewRun.id,
      userId: reviewRun.userId,
      agentId: agentIdForPersistence,
      role,
      status: 'running',
      findingsCount: 0,
      costEstimateUsd: 0,
    };
    this.agentRuns.set(agentRunId, agentRun);
    await this.persistAgentRun(agentRun);

    try {
      const executionAgent: AgentExecutionSpec = { ...agentSpec, agentRunId };
      const result = await this.ports.sandbox.runAgent(
        supervisor.sandboxId,
        executionAgent,
        diffContext,
        runToken,
        (event) => this.recordAgentEvent(agentRunId, event),
        controller.signal,
      );
      const normalizedResult = controller.signal.aborted
        ? { ...result, stopped: execution.stopReason, findings: [] }
        : sanitizeResult(result);
      await this.flushAgentEventWrites();
      await this.finishAgentRun(
        agentRunId,
        reviewRun,
        agentIdForPersistence,
        role,
        normalizedResult,
      );
      return normalizedResult;
    } catch (error) {
      await this.flushAgentEventWrites();
      if (controller.signal.aborted) {
        const stoppedResult = createStoppedAgentResult(agentSpec, execution.stopReason, error);
        await this.finishAgentRun(
          agentRunId,
          reviewRun,
          agentIdForPersistence,
          role,
          stoppedResult,
        );
        return stoppedResult;
      }
      const failedResult = createFailedAgentResult(agentSpec, error);
      await this.finishAgentRun(agentRunId, reviewRun, agentIdForPersistence, role, failedResult);
      return failedResult;
    } finally {
      supervisor.activeAgents.delete(agentRunId);
    }
  }

  private async finishAgentRun(
    agentRunId: string,
    reviewRun: ReviewRunRecord,
    agentIdForPersistence: string | null,
    role: AgentRunRole,
    result: AgentResult,
  ): Promise<void> {
    const agentRun = this.agentRuns.get(agentRunId);
    if (agentRun === undefined) return;

    agentRun.status = result.stopped ? 'cancelled' : result.error ? 'failed' : 'succeeded';
    agentRun.findingsCount = result.findings.length;
    agentRun.costEstimateUsd = result.costEstimateUsd;
    agentRun.modelUsed = result.modelUsed;
    agentRun.effortUsed = result.effortUsed;
    agentRun.usage = result.usage;
    agentRun.durationMs = result.durationMs;
    agentRun.stoppedReason = result.stopped;
    agentRun.error = result.error;
    await this.persistAgentRun(agentRun);

    if (role === 'specialist') {
      await Promise.all(
        result.findings.map((finding) =>
          this.persistFinding(createFindingRecord(reviewRun.userId, agentRunId, finding)),
        ),
      );
    }

    await this.ports.cost.recordLlmEstimate({
      userId: reviewRun.userId,
      repositoryId: reviewRun.repositoryId,
      reviewRunId: reviewRun.id,
      agentRunId,
      agentId: agentIdForPersistence,
      amountUsd: result.costEstimateUsd,
      idempotencyKey: createLlmEstimateIdempotencyKey(agentRunId),
    });
  }

  private recordAgentEvent(agentRunId: string, event: AgentEvent): void {
    const normalizedEvent = {
      ...event,
      agentRunId,
      ...(event.detail === undefined ? {} : { detail: redactRuntimeRecord(event.detail) }),
    };
    this.agentEvents.push(normalizedEvent);
    const write = this.ports.state?.upsertAgentEvent?.(normalizedEvent);
    if (write !== undefined) this.agentEventWrites.push(write);
  }

  private async flushAgentEventWrites(): Promise<void> {
    if (this.agentEventWrites.length === 0) return;
    const writes = this.agentEventWrites.splice(0);
    await Promise.all(writes);
  }

  private async stopActiveAgents(
    supervisor: SupervisorState,
    reason: NonNullable<AgentResult['stopped']>,
  ): Promise<void> {
    for (const execution of supervisor.activeAgents.values()) {
      execution.stopReason = reason;
      execution.controller.abort();
      await this.ports.sandbox.stop(supervisor.sandboxId, execution.agentRunId);
    }
  }

  private async updateCheckRun(
    input: Pick<PullRequestReviewInput, 'repository' | 'installationId'>,
    checkRunId: number | undefined,
    patch: CheckRunPatch,
  ): Promise<void> {
    if (checkRunId === undefined) return;
    await this.ports.github.updateCheckRun(repositoryExecutionContext(input), checkRunId, patch);
  }

  private async claimReviewPost(reviewRun: ReviewRunRecord): Promise<ReviewPostClaimResult> {
    const claimedAt = this.now();
    if (this.ports.state === undefined) return { status: 'claimed', claimedAt };
    return this.ports.state.claimReviewPost(reviewRun.id, claimedAt);
  }

  private async ownsReviewPostClaim(reviewRunId: string, claimedAt: Date): Promise<boolean> {
    if (this.ports.state === undefined) return true;
    return this.ports.state.ownsReviewPostClaim(reviewRunId, claimedAt);
  }

  private async refreshReviewPostClaim(
    reviewRunId: string,
    claimedAt: Date,
  ): Promise<Date | undefined> {
    const refreshedAt = this.now();
    if (this.ports.state === undefined) return refreshedAt;
    return this.ports.state.refreshReviewPostClaim(reviewRunId, claimedAt, refreshedAt);
  }

  private async findPostedReview(
    input: Pick<PullRequestReviewInput, 'repository' | 'installationId' | 'pullRequestNumber'>,
    reviewRunId: string,
  ): Promise<{ comments: number } | undefined> {
    return this.ports.github.findPostedReview(
      repositoryExecutionContext(input),
      input.pullRequestNumber,
      createSignedReviewRunMarker(reviewRunId, this.configuration.proxySigningKey),
    );
  }

  private isStaleReviewPostClaim(claimedAt: Date): boolean {
    return this.now().getTime() - claimedAt.getTime() >= staleReviewPostClaimMilliseconds;
  }

  private async terminateSandboxOnce(sandboxId: string): Promise<boolean> {
    if (this.terminatedSandboxIds.has(sandboxId)) return false;
    await this.ports.sandbox.terminate(sandboxId);
    this.terminatedSandboxIds.add(sandboxId);
    return true;
  }

  private async hydrateSupervisor(
    workflowId: string,
    input: PullRequestReviewInput,
  ): Promise<SupervisorState | undefined> {
    const persistedState = await this.ports.state?.loadPullRequestState(input);
    if (persistedState === undefined) return undefined;

    for (const reviewRun of persistedState.reviewRuns) {
      this.reviewRuns.set(reviewRun.id, reviewRun);
    }
    for (const agentRun of persistedState.agentRuns) {
      this.agentRuns.set(agentRun.id, agentRun);
    }

    const usableRun = persistedState.reviewRuns.find(
      (run) => run.sandboxId !== '' && run.checkRunId !== undefined,
    );
    if (usableRun === undefined) return undefined;

    const activeRun = persistedState.reviewRuns.find((run) => run.status === 'running');
    const supervisor: SupervisorState = {
      workflowId,
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
      sandboxId: usableRun.sandboxId,
      headSha: activeRun?.headSha ?? input.headSha,
      activeRunId: activeRun?.id,
      reviewedHeadShas: persistedState.reviewRuns
        .filter((run) => run.status === 'posted')
        .sort(compareReviewRunsChronologically)
        .map((run) => run.headSha),
      status: 'running',
      input,
      checkRunId: usableRun.checkRunId,
      activeAgents: new Map(),
      runPromises: new Map(),
    };

    this.supervisors.set(workflowId, supervisor);
    return supervisor;
  }

  private async persistReviewRun(run: ReviewRunRecord | undefined): Promise<void> {
    if (run === undefined) return;
    if (run.finishedAt !== undefined) {
      await this.recordSandboxEstimate(run);
    }
    await this.ports.state?.upsertReviewRun(run);
  }

  private async persistAgentRun(run: AgentRunRecord): Promise<void> {
    await this.ports.state?.upsertAgentRun(run);
  }

  private async persistFinding(finding: FindingRecord): Promise<void> {
    await this.ports.state?.upsertFinding?.(finding);
  }

  private async recordSandboxEstimate(run: ReviewRunRecord): Promise<void> {
    for (const window of getSandboxBillingWindows(run.startedAt, run.finishedAt!)) {
      const amountUsd = sandboxCost({ runtimeSeconds: window.runtimeSeconds }, SANDBOX_RESOURCES);
      await this.ports.cost.recordSandbox({
        userId: run.userId,
        repositoryId: run.repositoryId,
        reviewRunId: run.id,
        sandboxId: run.sandboxId,
        window: window.window,
        amountUsd,
        runtime: { runtimeSeconds: window.runtimeSeconds },
        resources: SANDBOX_RESOURCES,
        idempotencyKey: `sandbox:${run.sandboxId}:${window.window}`,
      });
    }
  }
}

function sanitizeAgentResultFindings(result: AgentResult, diffContext: DiffContext): AgentResult {
  return {
    ...result,
    findings: deduplicateFindings(
      anchorFindings(result.findings, diffContext).map((finding) => finding.finding),
    ),
  };
}

function getSandboxBillingWindows(
  startedAt: Date,
  finishedAt: Date,
): Array<{ window: string; runtimeSeconds: number }> {
  const windows: Array<{ window: string; runtimeSeconds: number }> = [];
  let cursor = startedAt.getTime();
  const finishedTime = Math.max(finishedAt.getTime(), cursor + 1_000);

  while (cursor < finishedTime) {
    const windowStart = floorToUtcHour(new Date(cursor));
    const nextWindowStart = windowStart.getTime() + 60 * 60 * 1000;
    const segmentEnd = Math.min(finishedTime, nextWindowStart);
    const runtimeSeconds = Math.max(1, Math.ceil((segmentEnd - cursor) / 1000));
    windows.push({ window: formatSandboxBillingWindow(windowStart), runtimeSeconds });
    cursor = segmentEnd;
  }

  return windows;
}

function floorToUtcHour(date: Date): Date {
  const floored = new Date(date);
  floored.setUTCMinutes(0, 0, 0);
  return floored;
}

function formatSandboxBillingWindow(date: Date): string {
  return date.toISOString().slice(0, 13);
}

function createFindingRecord(userId: number, agentRunId: string, finding: Finding): FindingRecord {
  const fingerprint = computeCanonicalFindingFingerprint(finding);
  return {
    ...finding,
    id: `${agentRunId}:${fingerprint}`,
    userId,
    agentRunId,
    anchored: finding.startLine !== null || finding.endLine !== null,
    fingerprint,
    verificationStatus: 'pending',
  };
}

function repositoryExecutionContext(
  input: Pick<PullRequestReviewInput, 'repository' | 'installationId'> & {
    repositoryId?: number;
  },
): RepositoryExecutionContext {
  return {
    ...input.repository,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
  };
}

function buildReviewPayload(
  headSha: string,
  diffContext: DiffContext,
  findings: Finding[],
): ReviewPayload {
  const commentableLineKeys = createCommentableLineKeys(diffContext);
  const comments = findings
    .flatMap((finding) => {
      const line = getFindingAnchorLine(finding);
      if (line === null) return [];
      if (!canAnchorFindingInDiff(commentableLineKeys, finding)) return [];

      return [
        {
          path: finding.path,
          body: `**${finding.title}**\n\n${finding.body}`,
          line,
          side: finding.side,
          startLine: finding.endLine === null ? undefined : (finding.startLine ?? undefined),
          startSide:
            finding.endLine === null || finding.startLine === null ? undefined : finding.side,
        },
      ];
    })
    .sort(compareReviewComments);
  const inlineCommentKeys = new Set(
    comments.map((comment) => `${comment.path}:${comment.side}:${comment.line}`),
  );
  const unanchoredFindings = findings.filter((finding) => {
    const line = getFindingAnchorLine(finding);
    return line === null || !inlineCommentKeys.has(`${finding.path}:${finding.side}:${line}`);
  });

  return {
    headSha,
    body:
      unanchoredFindings.length === 0
        ? 'Tribunal review findings.'
        : [
            'Tribunal review findings.',
            '',
            'Unanchored findings:',
            ...unanchoredFindings.map(
              (finding) =>
                `- **${formatFindingLocation(finding)}** ${finding.title}: ${finding.body}`,
            ),
          ].join('\n'),
    comments,
  };
}

function createCommentableLineKeys(diffContext: DiffContext): Set<string> {
  return new Set(
    diffContext.changedFiles.flatMap((file) =>
      file.commentableLines.map((line) => `${file.path}:${line.side}:${line.line}`),
    ),
  );
}

function canAnchorFindingInDiff(commentableLineKeys: Set<string>, finding: Finding): boolean {
  const line = getFindingAnchorLine(finding);
  if (line === null) return false;
  return commentableLineKeys.has(`${finding.path}:${finding.side}:${line}`);
}

function getFindingAnchorLine(finding: Finding): number | null {
  return finding.endLine ?? finding.startLine;
}

function formatFindingLocation(finding: Finding): string {
  const line = getFindingAnchorLine(finding);
  return `${finding.path}${line === null ? '' : `:${line}`}`;
}

function withReviewRunMarker(review: ReviewPayload, reviewMarker: string): ReviewPayload {
  return {
    ...review,
    body: `${review.body}\n\n${reviewMarker}`,
  };
}

function createSignedReviewRunMarker(reviewRunId: string, signingKey: string): string {
  const signature = createHmac('sha256', signingKey).update(reviewRunId).digest('base64url');
  return `<!-- tribunal-review-run:v1:${reviewRunId}:${signature} -->`;
}

function buildCompletedCheckRunPatch(
  agentResults: AgentResult[],
  diffContext: DiffContext,
  checkConclusionMode: CheckConclusionMode,
): CheckRunPatch {
  const failures = agentResults.filter((result) => result.error !== undefined);
  const findingsCount = agentResults.reduce((total, result) => total + result.findings.length, 0);
  const hasErrorSeverityFinding = agentResults.some((result) =>
    result.findings.some((finding) => finding.severity === 'error'),
  );
  const costEstimateUsd = agentResults.reduce((total, result) => total + result.costEstimateUsd, 0);
  const commentableLineKeys = createCommentableLineKeys(diffContext);
  const annotations = agentResults.flatMap((result) =>
    result.findings.flatMap((finding) =>
      createCheckRunAnnotation(result, finding, commentableLineKeys),
    ),
  );
  const agentLines = agentResults.map((result) => {
    const severityCounts = countSeverities(result.findings);
    const effort = result.effortUsed ?? 'inherit';
    const status = result.error === undefined ? 'completed' : `failed: ${result.error}`;
    return `- ${result.agentSlug}: ${status}; model ${result.modelUsed}; effort ${effort}; findings ${result.findings.length} (${formatSeverityCounts(severityCounts)}); estimated cost $${result.costEstimateUsd.toFixed(4)}.`;
  });
  const unanchoredFindingLines = agentResults.flatMap((result) =>
    result.findings
      .filter((finding) => !canAnnotateFindingInCheckRun(commentableLineKeys, finding))
      .map(
        (finding) =>
          `- ${result.agentSlug}: ${formatFindingLocation(finding)} ${finding.title}: ${finding.body}`,
      ),
  );

  return {
    status: 'completed',
    // Advisory (default): a clean run with no findings and no agent failures
    // is `success`; anything with findings or an agent failure is `neutral`
    // — Tribunal never blocks merges. Gating: an error-severity finding
    // promotes the conclusion to `failure`, so a repo that marks this check
    // required can actually block on it; agent failures alone still stay
    // `neutral` in gating mode — a review-pipeline hiccup, not a code issue,
    // isn't a reason to fail the merge gate.
    conclusion:
      checkConclusionMode === 'gating' && hasErrorSeverityFinding
        ? 'failure'
        : failures.length > 0 || findingsCount > 0
          ? 'neutral'
          : 'success',
    output: {
      title: 'Tribunal review complete',
      summary: [
        `${agentResults.length} agents finished with ${findingsCount} findings. Estimated cost: $${costEstimateUsd.toFixed(4)}.`,
        '',
        ...agentLines,
      ].join('\n'),
      text:
        unanchoredFindingLines.length === 0
          ? undefined
          : ['Findings:', ...unanchoredFindingLines].join('\n'),
      annotations,
    },
  };
}

function deduplicateAgentResultFindings(agentResults: AgentResult[]): AgentResult[] {
  const seenFingerprints = new Set<string>();

  return agentResults.map((result) => ({
    ...result,
    findings: result.findings.filter((finding) => {
      const fingerprint = computeCanonicalFindingFingerprint(finding);
      if (seenFingerprints.has(fingerprint)) return false;
      seenFingerprints.add(fingerprint);
      return true;
    }),
  }));
}

function canAnnotateFindingInCheckRun(commentableLineKeys: Set<string>, finding: Finding): boolean {
  return finding.side !== 'LEFT' && canAnchorFindingInDiff(commentableLineKeys, finding);
}

function createCheckRunAnnotation(
  result: AgentResult,
  finding: Finding,
  commentableLineKeys: Set<string>,
) {
  if (!canAnnotateFindingInCheckRun(commentableLineKeys, finding)) return [];
  const line = getFindingAnchorLine(finding)!;
  const startLine = finding.startLine ?? line;
  const endLine = finding.endLine ?? line;
  return [
    {
      path: finding.path,
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
      annotationLevel: mapSeverityToAnnotationLevel(finding.severity),
      message: finding.body,
      title: `[${result.agentSlug}] ${finding.title}`,
      rawDetails: `model=${result.modelUsed}; effort=${result.effortUsed ?? 'inherit'}; estimatedCostUsd=${result.costEstimateUsd.toFixed(4)}`,
    },
  ];
}

function mapSeverityToAnnotationLevel(
  severity: Finding['severity'],
): 'notice' | 'warning' | 'failure' {
  if (severity === 'error') return 'failure';
  if (severity === 'warning') return 'warning';
  return 'notice';
}

function countSeverities(findings: Finding[]): Record<Finding['severity'], number> {
  return findings.reduce(
    (counts, finding) => ({
      ...counts,
      [finding.severity]: counts[finding.severity] + 1,
    }),
    { info: 0, warning: 0, error: 0 },
  );
}

function formatSeverityCounts(counts: Record<Finding['severity'], number>): string {
  return `info ${counts.info}, warning ${counts.warning}, error ${counts.error}`;
}

/**
 * Sensible defaults for the pre-LLM path-filter skip: lockfiles, generated
 * code, and vendored dependencies rarely benefit from review. Always unioned
 * with the repo's configured `ignoreGlobs` — never a replacement for them.
 */
export const DEFAULT_IGNORE_GLOBS: readonly string[] = [
  'bun.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.generated.*',
  '**/*.generated.*',
  'vendor/**',
  '**/vendor/**',
];

/**
 * Hashes the reviewed diff's content (path + patch per changed file),
 * independent of commit sha. Used to detect "diff unchanged since last
 * review" — a rebase or force-push that doesn't change the actual patch.
 */
export function computePatchId(diffContext: DiffContext): string {
  const sortedFiles = [...diffContext.changedFiles].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const payload = JSON.stringify(
    sortedFiles.map((file) => ({ path: file.path, status: file.status, patch: file.patch ?? '' })),
  );
  return createHash('sha256').update(payload).digest('hex');
}

function shouldSkipIgnoredDiff(diffContext: DiffContext, ignoreGlobs: string[]): boolean {
  if (ignoreGlobs.length === 0 || diffContext.changedFiles.length === 0) return false;

  return diffContext.changedFiles.every((file) =>
    ignoreGlobs.some((ignoreGlob) => matchesIgnoreGlob(file.path, ignoreGlob)),
  );
}

function matchesIgnoreGlob(path: string, ignoreGlob: string): boolean {
  const normalizedGlob = ignoreGlob.trim().replace(/^\/+/, '');
  if (normalizedGlob === '') return false;
  if (!normalizedGlob.includes('*')) return path === normalizedGlob;

  const pattern = normalizedGlob
    .split(/(\*\*)/u)
    .map((part) => {
      if (part === '**') return '.*';
      return part.split('*').map(escapeRegExp).join('[^/]*');
    })
    .join('');
  return new RegExp(`^${pattern}$`, 'u').test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function createFailedAgentResult(agent: AgentSpec, error: unknown): AgentResult {
  const partialResult = getPartialAgentResult(error);
  return {
    agentSlug: agent.slug,
    findings: [],
    modelUsed:
      partialResult?.modelUsed ?? (typeof agent.model === 'string' ? agent.model : 'inherit'),
    effortUsed: partialResult?.effortUsed ?? agent.effort ?? null,
    usage: partialResult?.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: partialResult?.costEstimateUsd ?? 0,
    durationMs: partialResult?.durationMs ?? 0,
    error: error instanceof Error ? error.message : 'Agent review failed.',
  };
}

function createStoppedAgentResult(
  agent: AgentSpec,
  stopped: NonNullable<AgentResult['stopped']>,
  error?: unknown,
): AgentResult {
  const partialResult = getPartialAgentResult(error);
  return {
    agentSlug: agent.slug,
    findings: [],
    modelUsed:
      partialResult?.modelUsed ?? (typeof agent.model === 'string' ? agent.model : 'inherit'),
    effortUsed: partialResult?.effortUsed ?? agent.effort ?? null,
    usage: partialResult?.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: partialResult?.costEstimateUsd ?? 0,
    durationMs: partialResult?.durationMs ?? 0,
    stopped,
  };
}

function getPartialAgentResult(error: unknown): Partial<AgentResult> | undefined {
  const record = getUnknownRecord(error);
  const candidate = getUnknownRecord(record?.partialResult);
  const rawCostEstimateUsd = candidate?.costEstimateUsd;
  if (
    rawCostEstimateUsd === undefined ||
    rawCostEstimateUsd === null ||
    (typeof rawCostEstimateUsd === 'string' && rawCostEstimateUsd.trim() === '')
  ) {
    return undefined;
  }
  const costEstimateUsd = Number(rawCostEstimateUsd);
  if (!Number.isFinite(costEstimateUsd) || costEstimateUsd < 0) return undefined;

  const usage = getUnknownRecord(candidate?.usage);
  return {
    costEstimateUsd,
    durationMs: toNonnegativeFiniteNumber(candidate?.durationMs),
    modelUsed: typeof candidate?.modelUsed === 'string' ? candidate.modelUsed : undefined,
    effortUsed:
      candidate?.effortUsed === 'low' ||
      candidate?.effortUsed === 'medium' ||
      candidate?.effortUsed === 'high' ||
      candidate?.effortUsed === 'xhigh' ||
      candidate?.effortUsed === 'max' ||
      candidate?.effortUsed === null
        ? candidate.effortUsed
        : undefined,
    usage: {
      inputTokens: toNonnegativeInteger(usage?.inputTokens),
      outputTokens: toNonnegativeInteger(usage?.outputTokens),
      cacheReadTokens: toNonnegativeInteger(usage?.cacheReadTokens),
      cacheCreationTokens: toNonnegativeInteger(usage?.cacheCreationTokens),
    },
  };
}

function getUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toNonnegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function toNonnegativeFiniteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function toSupervisorSnapshot(supervisor: SupervisorState): PullRequestSupervisorSnapshot {
  return {
    workflowId: supervisor.workflowId,
    repositoryId: supervisor.repositoryId,
    pullRequestNumber: supervisor.pullRequestNumber,
    sandboxId: supervisor.sandboxId,
    headSha: supervisor.headSha,
    activeRunId: supervisor.activeRunId,
    reviewedHeadShas: [...supervisor.reviewedHeadShas],
    status: supervisor.status,
  };
}

function compareSupervisorSnapshots(
  left: PullRequestSupervisorSnapshot,
  right: PullRequestSupervisorSnapshot,
): number {
  return left.workflowId < right.workflowId ? -1 : left.workflowId > right.workflowId ? 1 : 0;
}

function compareReviewRuns(left: ReviewRunRecord, right: ReviewRunRecord): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isReusableReviewRun(run: ReviewRunRecord): boolean {
  return run.status === 'posted';
}

function isStoppedReviewRun(run: ReviewRunRecord): boolean {
  return run.status === 'superseded' || run.status === 'cancelled';
}

function compareReviewRunsChronologically(left: ReviewRunRecord, right: ReviewRunRecord): number {
  if (left.startedAt.getTime() !== right.startedAt.getTime()) {
    return left.startedAt.getTime() - right.startedAt.getTime();
  }
  return compareReviewRuns(left, right);
}

function compareAgentRuns(left: AgentRunRecord, right: AgentRunRecord): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareReviewComments(
  left: ReviewPayload['comments'][number],
  right: ReviewPayload['comments'][number],
): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.side !== right.side) return left.side < right.side ? -1 : 1;
  return left.line - right.line;
}
