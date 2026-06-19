import type { AgentEvent, AgentResult, AgentSpec, DiffContext } from './types';

export interface RepoRef {
  owner: string;
  name: string;
}

export interface ScopedToken {
  token: string;
  expiresAt: Date;
}

export interface CheckRunPatch {
  status?: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required';
  output?: {
    title: string;
    summary: string;
    text?: string;
  };
}

export interface ReviewPayload {
  headSha: string;
  body: string;
  comments: Array<{
    path: string;
    body: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    startLine?: number;
    startSide?: 'LEFT' | 'RIGHT';
  }>;
}

export interface PostedReviewRecord {
  comments: number;
}

export interface GitHubPort {
  mintReadToken(repositoryId: number, installationId: number): Promise<ScopedToken>;
  getDiffContext(
    repository: RepoRef,
    pullRequestNumber: number,
    head: string,
    previousHead?: string,
  ): Promise<DiffContext>;
  createCheckRun(repository: RepoRef, headSha: string): Promise<{ checkRunId: number }>;
  updateCheckRun(repository: RepoRef, checkRunId: number, patch: CheckRunPatch): Promise<void>;
  postReview(
    repository: RepoRef,
    pullRequestNumber: number,
    review: ReviewPayload,
  ): Promise<{ comments: number }>;
}

export interface SandboxOptions {
  image: string;
  proxyUrl: string;
}

export interface SandboxPort {
  ensure(prKey: string, options: SandboxOptions): Promise<{ sandboxId: string }>;
  update(sandboxId: string, repository: RepoRef, head: string, runToken: string): Promise<void>;
  runAgent(
    sandboxId: string,
    agent: AgentSpec,
    diffContext: DiffContext,
    runToken: string,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<AgentResult>;
  stop(sandboxId: string, agentRunId: string): Promise<void>;
  suspend(sandboxId: string): Promise<void>;
  terminate(sandboxId: string): Promise<void>;
}

export interface LlmEstimateInput {
  userId: number;
  repositoryId: number;
  reviewRunId: string;
  agentRunId: string;
  agentId: string;
  amountUsd: number;
  idempotencyKey: string;
}

export interface SandboxCostInput {
  userId: number;
  repositoryId: number;
  reviewRunId: string;
  sandboxId: string;
  amountUsd: number;
  idempotencyKey: string;
}

export interface CostPort {
  recordLlmEstimate(event: LlmEstimateInput): Promise<void>;
  recordSandbox(event: SandboxCostInput): Promise<void>;
  reconcile(reviewRunId: string): Promise<void>;
  spendTodayEstimate(userId: number): Promise<number>;
}
