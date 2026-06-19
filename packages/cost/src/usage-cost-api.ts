export type UsageCostApiEvent = {
  id: string;
  occurredAt: Date;
  amountUsd: number;
  userId: number;
  repositoryId: number | null;
  reviewRunId: string;
  agentRunId: string | null;
  agentId: string | null;
  metadata?: Record<string, unknown>;
};

export type UsageCostApiClient = {
  listReviewRunCosts(reviewRunId: string): Promise<UsageCostApiEvent[]>;
};
