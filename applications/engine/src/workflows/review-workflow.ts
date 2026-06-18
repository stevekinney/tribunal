import type {
  AgentEvent,
  AgentResult,
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
} from './identifiers';

export type ReviewIntentKind = 'start' | 'commit_pushed' | 'pr_closed';

export type PullRequestReviewTrigger = 'opened' | 'synchronize' | 'reopened' | 'manual';

export type PullRequestReviewInput = {
  userId: number;
  repositoryId: number;
  installationId: number;
  repository: RepoRef;
  pullRequestNumber: number;
  headSha: string;
  trigger: PullRequestReviewTrigger;
  agents: AgentSpec[];
  dailyCostCapUsd: number;
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
  markReviewIntentProcessed(intentId: string, claimedAt: Date, now: Date): Promise<void>;
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
  maxConcurrentAgents: number;
};

export type ReviewRunStatus =
  | 'queued'
  | 'running'
  | 'posted'
  | 'superseded'
  | 'failed'
  | 'cancelled'
  | 'quota_blocked';

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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
  commentsPosted: number;
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
  agentId: string;
  status: AgentRunStatus;
  findingsCount: number;
  costEstimateUsd: number;
  stoppedReason?: AgentResult['stopped'];
  error?: string;
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
  github: GitHubPort;
  sandbox: SandboxPort;
  cost: CostPort;
  intents: ReviewIntentPort;
};

export type ReviewWorkflowSnapshot = {
  supervisors: PullRequestSupervisorSnapshot[];
  reviewRuns: ReviewRunRecord[];
  agentRuns: AgentRunRecord[];
  agentEvents: AgentEvent[];
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
        await this.ports.intents.markReviewIntentProcessed(intent.id, intent.claimedAt, this.now());
        processed += 1;
      } catch (error) {
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

    const previousHeadSha = supervisor.reviewedHeadShas.at(-1) ?? supervisor.headSha;
    await this.stopActiveAgents(supervisor, 'superseded');
    const activeRun = supervisor.activeRunId
      ? this.reviewRuns.get(supervisor.activeRunId)
      : undefined;
    if (activeRun?.status === 'running') {
      activeRun.status = 'superseded';
      activeRun.finishedAt = this.now();
    }

    supervisor.input = input;
    supervisor.headSha = input.headSha;

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
    const supervisor = this.supervisors.get(workflowId);
    if (supervisor === undefined || supervisor.status === 'closed') return;

    await this.stopActiveAgents(supervisor, 'pr_closed');
    const activeRun = supervisor.activeRunId
      ? this.reviewRuns.get(supervisor.activeRunId)
      : undefined;
    if (activeRun?.status === 'running') {
      activeRun.status = 'cancelled';
      activeRun.finishedAt = this.now();
    }

    if (supervisor.checkRunId !== undefined) {
      await this.ports.github.updateCheckRun(input.repository, supervisor.checkRunId, {
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
  ): Promise<void> {
    const agentRunId = `arun:${reviewRunId}:${agentId}`;
    for (const supervisor of this.supervisors.values()) {
      const execution = supervisor.activeAgents.get(agentRunId);
      if (execution !== undefined) {
        execution.stopReason = reason;
        execution.controller.abort();
        await this.ports.sandbox.stop(supervisor.sandboxId, agentRunId);
      }
    }
  }

  async stopRun(
    reviewRunId: string,
    reason: NonNullable<AgentResult['stopped']> = 'timeout',
  ): Promise<StopReviewRunResult> {
    for (const supervisor of this.supervisors.values()) {
      if (supervisor.activeRunId !== reviewRunId) continue;

      await this.stopActiveAgents(supervisor, reason);
      const run = this.reviewRuns.get(reviewRunId);
      if (run?.status === 'running') {
        run.status = 'cancelled';
        run.finishedAt = this.now();
      }
      await this.updateCheckRun(supervisor.input.repository, supervisor.checkRunId, {
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
    };
  }

  async processClaimedReviewIntent(intent: ClaimedReviewIntent): Promise<void> {
    if (intent.kind === 'start') {
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
    const sandboxKey = createPullRequestSandboxKey({
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
    });
    const { sandboxId } = await this.ports.sandbox.ensure(sandboxKey, {
      image: this.configuration.sandboxImage,
      proxyUrl: this.configuration.proxyUrl,
    });
    const { checkRunId } = await this.ports.github.createCheckRun(input.repository, input.headSha);
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
        const run = this.reviewRuns.get(runId);
        if (run !== undefined) {
          run.status = 'failed';
          run.error = error instanceof Error ? error.message : 'Review run failed.';
          run.finishedAt = this.now();
        }
        throw error;
      })
      .finally(() => {
        const run = this.reviewRuns.get(runId);
        if (run !== undefined && run.status !== 'running') {
          supervisor.runPromises.delete(runId);
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
    const startedAt = this.now();
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
      sandboxId: supervisor.sandboxId,
      checkRunId: supervisor.checkRunId,
      commentsPosted: 0,
      costEstimateUsd: 0,
      startedAt,
    };
    this.reviewRuns.set(runId, reviewRun);
    supervisor.activeRunId = runId;

    const spendTodayEstimate = await this.ports.cost.spendTodayEstimate(input.userId);
    if (spendTodayEstimate >= input.dailyCostCapUsd) {
      reviewRun.status = 'quota_blocked';
      reviewRun.finishedAt = this.now();
      await this.updateCheckRun(input.repository, supervisor.checkRunId, {
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
      input.repository,
      input.pullRequestNumber,
      headSha,
      previousHeadSha,
    );
    const enabledAgents = input.agents.filter((agent) => agent.enabled);
    const { results: agentResults, quotaBlocked } = await this.runAgents(
      supervisor,
      reviewRun,
      enabledAgents,
      runToken,
      input.dailyCostCapUsd,
    );

    if (reviewRun.status === 'superseded' || reviewRun.status === 'cancelled') return reviewRun;
    if (quotaBlocked) {
      reviewRun.costEstimateUsd = agentResults.reduce(
        (total, result) => total + result.costEstimateUsd,
        0,
      );
      reviewRun.status = 'quota_blocked';
      reviewRun.finishedAt = this.now();
      await this.updateCheckRun(input.repository, supervisor.checkRunId, {
        status: 'completed',
        conclusion: 'neutral',
        output: {
          title: 'Tribunal review quota blocked',
          summary: 'Daily review cost cap reached before all enabled agents could run.',
        },
      });
      return reviewRun;
    }

    const findings = agentResults.flatMap((result) => result.findings);
    const reviewPayload = buildReviewPayload(headSha, diffContext, findings);
    if (reviewPayload.comments.length > 0 && !this.postedReviewRunIds.has(reviewRun.id)) {
      const posted = await this.ports.github.postReview(
        input.repository,
        input.pullRequestNumber,
        reviewPayload,
      );
      reviewRun.commentsPosted = posted.comments;
      this.postedReviewRunIds.add(reviewRun.id);
    }
    reviewRun.costEstimateUsd = agentResults.reduce(
      (total, result) => total + result.costEstimateUsd,
      0,
    );
    reviewRun.status = 'posted';
    reviewRun.finishedAt = this.now();
    supervisor.reviewedHeadShas.push(headSha);

    await this.updateCheckRun(
      input.repository,
      supervisor.checkRunId,
      buildCompletedCheckRunPatch(agentResults),
    );
    return reviewRun;
  }

  private async runAgents(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    agents: AgentSpec[],
    runToken: string,
    dailyCostCapUsd: number,
  ): Promise<{ results: AgentResult[]; quotaBlocked: boolean }> {
    const results: AgentResult[] = [];

    for (const agent of agents) {
      if (reviewRun.status === 'superseded' || reviewRun.status === 'cancelled') {
        return { results, quotaBlocked: false };
      }

      const spendTodayEstimate = await this.ports.cost.spendTodayEstimate(reviewRun.userId);
      if (spendTodayEstimate >= dailyCostCapUsd) {
        return { results, quotaBlocked: true };
      }

      results.push(await this.runAgentReview(supervisor, reviewRun, agent, runToken));
    }

    return { results, quotaBlocked: false };
  }

  private async runAgentReview(
    supervisor: SupervisorState,
    reviewRun: ReviewRunRecord,
    agent: AgentSpec,
    runToken: string,
  ): Promise<AgentResult> {
    const agentRunId = createAgentRunId(reviewRun.id, agent);
    const controller = new AbortController();
    const execution: AgentExecution = { agentRunId, controller, stopReason: 'superseded' };
    supervisor.activeAgents.set(agentRunId, execution);
    this.agentRuns.set(agentRunId, {
      id: agentRunId,
      idempotencyKey: createAgentReviewIdempotencyKey(reviewRun.id, agent),
      reviewRunId: reviewRun.id,
      agentId: agent.id,
      status: 'running',
      findingsCount: 0,
      costEstimateUsd: 0,
    });

    try {
      const result = await this.ports.sandbox.runAgent(
        supervisor.sandboxId,
        agentRunId,
        agent,
        runToken,
        (event) => this.recordAgentEvent(agentRunId, event),
        controller.signal,
      );
      const normalizedResult = controller.signal.aborted
        ? { ...result, stopped: execution.stopReason, findings: [] }
        : result;
      await this.finishAgentRun(agentRunId, reviewRun, agent, normalizedResult);
      return normalizedResult;
    } catch (error) {
      if (controller.signal.aborted) {
        const stoppedResult = createStoppedAgentResult(agent, execution.stopReason);
        await this.finishAgentRun(agentRunId, reviewRun, agent, stoppedResult);
        return stoppedResult;
      }
      const failedResult = createFailedAgentResult(agent, error);
      await this.finishAgentRun(agentRunId, reviewRun, agent, failedResult);
      return failedResult;
    } finally {
      supervisor.activeAgents.delete(agentRunId);
    }
  }

  private async finishAgentRun(
    agentRunId: string,
    reviewRun: ReviewRunRecord,
    agent: AgentSpec,
    result: AgentResult,
  ): Promise<void> {
    const agentRun = this.agentRuns.get(agentRunId);
    if (agentRun === undefined) return;

    agentRun.status = result.stopped ? 'cancelled' : result.error ? 'failed' : 'succeeded';
    agentRun.findingsCount = result.findings.length;
    agentRun.costEstimateUsd = result.costEstimateUsd;
    agentRun.stoppedReason = result.stopped;
    agentRun.error = result.error;

    await this.ports.cost.recordLlmEstimate({
      userId: reviewRun.userId,
      reviewRunId: reviewRun.id,
      agentRunId,
      agentId: agent.id,
      amountUsd: result.costEstimateUsd,
      idempotencyKey: createLlmEstimateIdempotencyKey(agentRunId),
    });
  }

  private recordAgentEvent(agentRunId: string, event: AgentEvent): void {
    this.agentEvents.push({ ...event, agentRunId });
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
    repository: RepoRef,
    checkRunId: number | undefined,
    patch: CheckRunPatch,
  ): Promise<void> {
    if (checkRunId === undefined) return;
    await this.ports.github.updateCheckRun(repository, checkRunId, patch);
  }

  private async terminateSandboxOnce(sandboxId: string): Promise<boolean> {
    if (this.terminatedSandboxIds.has(sandboxId)) return false;
    await this.ports.sandbox.terminate(sandboxId);
    this.terminatedSandboxIds.add(sandboxId);
    return true;
  }
}

function buildReviewPayload(
  headSha: string,
  diffContext: DiffContext,
  findings: Finding[],
): ReviewPayload {
  const commentableLines = new Set(
    diffContext.changedFiles.flatMap((file) =>
      file.commentableLines.map((line) => `${file.path}:${line.side}:${line.line}`),
    ),
  );
  const comments = findings
    .filter((finding) => {
      if (finding.startLine === null) return false;
      return commentableLines.has(`${finding.path}:${finding.side}:${finding.startLine}`);
    })
    .map((finding) => ({
      path: finding.path,
      body: `**${finding.title}**\n\n${finding.body}`,
      line: finding.startLine ?? 1,
      side: finding.side,
      startLine: finding.endLine === null ? undefined : (finding.startLine ?? undefined),
      startSide: finding.endLine === null ? undefined : finding.side,
    }))
    .sort(compareReviewComments);

  return {
    headSha,
    body: 'Tribunal review findings.',
    comments,
  };
}

function buildCompletedCheckRunPatch(agentResults: AgentResult[]): CheckRunPatch {
  const failures = agentResults.filter((result) => result.error !== undefined);
  const findingsCount = agentResults.reduce((total, result) => total + result.findings.length, 0);
  const costEstimateUsd = agentResults.reduce((total, result) => total + result.costEstimateUsd, 0);

  return {
    status: 'completed',
    conclusion: failures.length > 0 ? 'neutral' : 'success',
    output: {
      title: 'Tribunal review complete',
      summary: `${agentResults.length} agents finished with ${findingsCount} findings. Estimated cost: $${costEstimateUsd.toFixed(4)}.`,
    },
  };
}

function createFailedAgentResult(agent: AgentSpec, error: unknown): AgentResult {
  return {
    agentSlug: agent.slug,
    findings: [],
    modelUsed: typeof agent.model === 'string' ? agent.model : 'inherit',
    effortUsed: agent.effort ?? null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: 0,
    durationMs: 0,
    error: error instanceof Error ? error.message : 'Agent review failed.',
  };
}

function createStoppedAgentResult(
  agent: AgentSpec,
  stopped: NonNullable<AgentResult['stopped']>,
): AgentResult {
  return {
    agentSlug: agent.slug,
    findings: [],
    modelUsed: typeof agent.model === 'string' ? agent.model : 'inherit',
    effortUsed: agent.effort ?? null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: 0,
    durationMs: 0,
    stopped,
  };
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
  return left.workflowId < right.workflowId ? -1 : 1;
}

function compareReviewRuns(left: ReviewRunRecord, right: ReviewRunRecord): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isReusableReviewRun(run: ReviewRunRecord): boolean {
  return run.status === 'posted';
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
