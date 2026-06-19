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

export type UsageCostReconciliationTarget = {
  reviewRunId: string;
  userId: number;
  repositoryId: number;
  startedAt: Date;
  finishedAt: Date | null;
};

export type UsageCostApiClient = {
  listReviewRunCosts(target: UsageCostReconciliationTarget): Promise<UsageCostApiEvent[]>;
};
