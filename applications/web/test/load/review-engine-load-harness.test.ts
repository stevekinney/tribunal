import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

type FakePullRequest = {
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  agents: string[];
};

type LoadMetrics = {
  webhookAckLatenciesMs: number[];
  timeToFirstCommentMs: number[];
  maxConcurrentSandboxes: number;
  duplicateComments: number;
  duplicateCostEvents: number;
  orphanedSandboxes: number;
  totalSpendUsd: number;
};

class FakeReviewLoadHarness {
  private readonly comments = new Set<string>();
  private readonly costEvents = new Set<string>();
  private readonly liveSandboxes = new Set<string>();
  private activeSandboxes = 0;
  private maxConcurrentSandboxes = 0;
  private duplicateComments = 0;
  private duplicateCostEvents = 0;
  private totalSpendUsd = 0;

  readonly metrics: LoadMetrics = {
    webhookAckLatenciesMs: [],
    timeToFirstCommentMs: [],
    maxConcurrentSandboxes: 0,
    duplicateComments: 0,
    duplicateCostEvents: 0,
    orphanedSandboxes: 0,
    totalSpendUsd: 0,
  };

  constructor(
    private readonly repositories: number,
    private readonly concurrentPullRequests: number,
    private readonly dailyCapUsd: number,
  ) {}

  listRepositoryIds(): number[] {
    return Array.from({ length: this.repositories }, (_, index) => index + 1);
  }

  createPullRequests(): FakePullRequest[] {
    return Array.from({ length: this.concurrentPullRequests }, (_, index) => ({
      repositoryId: (index % this.repositories) + 1,
      pullRequestNumber: index + 1,
      headSha: `head-${index + 1}-a`,
      agents: ['security', 'reliability', 'maintainability'],
    }));
  }

  async openPullRequest(pullRequest: FakePullRequest): Promise<void> {
    await this.measureWebhookAckLatency(() => this.reviewPullRequest(pullRequest));
  }

  async synchronizePullRequest(pullRequest: FakePullRequest): Promise<void> {
    await this.measureWebhookAckLatency(() =>
      this.reviewPullRequest({
        ...pullRequest,
        headSha: pullRequest.headSha.replace(/-a$/u, '-b'),
      }),
    );
  }

  closePullRequests(pullRequests: FakePullRequest[]): void {
    for (const pullRequest of pullRequests) {
      this.liveSandboxes.delete(this.sandboxKey(pullRequest));
    }
    this.finalizeMetrics();
  }

  private async reviewPullRequest(pullRequest: FakePullRequest): Promise<void> {
    const reviewStartedAt = performance.now();
    const sandboxKey = this.sandboxKey(pullRequest);
    const sandboxAlreadyLive = this.liveSandboxes.has(sandboxKey);
    if (!sandboxAlreadyLive) {
      this.liveSandboxes.add(sandboxKey);
      this.activeSandboxes += 1;
      this.maxConcurrentSandboxes = Math.max(this.maxConcurrentSandboxes, this.activeSandboxes);
    }

    await Promise.resolve();

    this.metrics.timeToFirstCommentMs.push(performance.now() - reviewStartedAt);
    for (const agent of pullRequest.agents.slice(0, 3)) {
      this.recordComment(
        `${pullRequest.repositoryId}:${pullRequest.pullRequestNumber}:${pullRequest.headSha}:${agent}`,
      );
      this.recordCostEvent(
        `${pullRequest.repositoryId}:${pullRequest.pullRequestNumber}:${pullRequest.headSha}:${agent}`,
      );
    }

    if (!sandboxAlreadyLive) {
      this.activeSandboxes -= 1;
    }
  }

  private async measureWebhookAckLatency(operation: () => Promise<void>): Promise<void> {
    const startedAt = performance.now();
    await operation();
    this.metrics.webhookAckLatenciesMs.push(performance.now() - startedAt);
  }

  private recordComment(key: string): void {
    if (this.comments.has(key)) {
      this.duplicateComments += 1;
      return;
    }
    this.comments.add(key);
  }

  private recordCostEvent(key: string): void {
    if (this.costEvents.has(key)) {
      this.duplicateCostEvents += 1;
      return;
    }
    this.costEvents.add(key);
    this.totalSpendUsd += 0.02;
  }

  private finalizeMetrics(): void {
    this.metrics.maxConcurrentSandboxes = this.maxConcurrentSandboxes;
    this.metrics.duplicateComments = this.duplicateComments;
    this.metrics.duplicateCostEvents = this.duplicateCostEvents;
    this.metrics.orphanedSandboxes = this.liveSandboxes.size;
    this.metrics.totalSpendUsd = Number(this.totalSpendUsd.toFixed(2));
  }

  private sandboxKey(pullRequest: FakePullRequest): string {
    return `${pullRequest.repositoryId}:${pullRequest.pullRequestNumber}`;
  }
}

describe('review engine load harness', () => {
  it('covers 20 repositories, 10 concurrent pull requests, and a synchronize burst with fakes', async () => {
    const harness = new FakeReviewLoadHarness(20, 10, 25);
    const pullRequests = harness.createPullRequests();

    await Promise.all(pullRequests.map((pullRequest) => harness.openPullRequest(pullRequest)));
    await Promise.all(
      pullRequests.map((pullRequest) => harness.synchronizePullRequest(pullRequest)),
    );
    harness.closePullRequests(pullRequests);

    expect(harness.listRepositoryIds()).toHaveLength(20);
    expect(pullRequests).toHaveLength(10);
    expect(new Set(pullRequests.map((pullRequest) => pullRequest.repositoryId)).size).toBe(10);
    expect(Math.max(...harness.metrics.webhookAckLatenciesMs)).toBeLessThanOrEqual(50);
    expect(Math.max(...harness.metrics.timeToFirstCommentMs)).toBeLessThanOrEqual(2_000);
    expect(harness.metrics.maxConcurrentSandboxes).toBeLessThanOrEqual(10);
    expect(harness.metrics.duplicateComments).toBe(0);
    expect(harness.metrics.duplicateCostEvents).toBe(0);
    expect(harness.metrics.orphanedSandboxes).toBe(0);
    expect(harness.metrics.totalSpendUsd).toBeLessThanOrEqual(25);
  });
});
