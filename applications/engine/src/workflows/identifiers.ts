import type { AgentSpec } from '@tribunal/review-core';

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

export function createRunCapabilityToken(reviewRunId: string): string {
  return `run-token:${reviewRunId}`;
}
