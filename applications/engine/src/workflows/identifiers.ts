import { mintCapabilityToken } from '@tribunal/review-core/capability-token';
import type { AgentSpec, RepoRef } from '@tribunal/review-core';

export type PullRequestIdentity = {
  repositoryId: number;
  pullRequestNumber: number;
};

export type ReviewRunIdentity = PullRequestIdentity & {
  headSha: string;
  trigger: string;
};

export function createPullRequestWorkflowId(identity: PullRequestIdentity): string {
  return `review:pr:${identity.repositoryId}:${identity.pullRequestNumber}`;
}

export function createPullRequestSandboxKey(identity: PullRequestIdentity): string {
  return `tribunal-pr-${identity.repositoryId}-${identity.pullRequestNumber}`;
}

export function createReviewRunId(identity: ReviewRunIdentity): string {
  return `run:${identity.repositoryId}:${identity.pullRequestNumber}:${identity.headSha}:${identity.trigger}`;
}

export function createReviewRunIdempotencyKey(identity: ReviewRunIdentity): string {
  return `review:run:${identity.repositoryId}:${identity.pullRequestNumber}:${identity.headSha}:${identity.trigger}`;
}

export function createAgentRunId(reviewRunId: string, agent: AgentSpec): string {
  return `arun:${reviewRunId}:${agent.id}`;
}

export function createAgentReviewIdempotencyKey(reviewRunId: string, agent: AgentSpec): string {
  return `agent:${reviewRunId}:${agent.id}`;
}

export function createLlmEstimateIdempotencyKey(agentRunId: string): string {
  return `llm:${agentRunId}:estimate`;
}

export type RunCapabilityTokenInput = {
  reviewRunId: string;
  userId: number;
  repositoryId: number;
  installationId: number;
  repository: RepoRef;
  expiresAt: Date;
  signingKey: string;
};

export function createRunCapabilityToken(input: RunCapabilityTokenInput): string {
  return mintCapabilityToken(
    {
      version: 1,
      runId: input.reviewRunId,
      userId: input.userId,
      repositoryId: input.repositoryId,
      installationId: input.installationId,
      repositoryOwner: input.repository.owner,
      repositoryName: input.repository.name,
      permissions: ['github:read', 'anthropic:invoke'],
      expiresAtEpochSeconds: Math.floor(input.expiresAt.getTime() / 1000),
    },
    input.signingKey,
  );
}
