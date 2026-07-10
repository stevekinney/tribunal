import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import WorkflowInspectorPage from './+page.svelte';
import type { PageData } from './$types';

const user = {
  id: 1,
  username: 'testuser',
  name: 'Test User',
  avatarUrl: null,
  email: 'test@example.com',
  isPlatformAdministrator: true,
};

const data = {
  user,
  enabled: true,
  runs: [
    {
      id: 'run_1',
      runId: 'run_1',
      runKind: 'pull_request_review' as const,
      userId: 1,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      prevHeadSha: null,
      patchId: null,
      trigger: 'opened',
      status: 'running',
      workflowId: null,
      sandboxId: 'sandbox_1',
      checkRunId: 123,
      commentsPosted: 0,
      reviewPostClaimedAt: null,
      costEstimateUsd: '1.00',
      startedAt: new Date('2026-06-17T12:00:00Z'),
      finishedAt: null,
      error: null,
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
    },
    {
      id: 'run_2',
      runId: 'run_2',
      runKind: 'pull_request_review' as const,
      userId: 1,
      repositoryId: 9001,
      prNumber: 13,
      headSha: 'def456',
      prevHeadSha: null,
      patchId: null,
      trigger: 'manual',
      status: 'cancelled',
      workflowId: null,
      sandboxId: 'sandbox_2',
      checkRunId: 124,
      commentsPosted: 0,
      reviewPostClaimedAt: null,
      costEstimateUsd: '0.50',
      startedAt: new Date('2026-06-17T13:00:00Z'),
      finishedAt: new Date('2026-06-17T13:05:00Z'),
      error: 'Stopped by operator.',
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
    },
    {
      id: 'run_3',
      runId: 'run_3',
      runKind: 'pull_request_review' as const,
      userId: 1,
      repositoryId: 9001,
      prNumber: 14,
      headSha: 'ghi789',
      prevHeadSha: null,
      patchId: null,
      trigger: 'manual',
      status: 'quota_blocked',
      workflowId: null,
      sandboxId: 'sandbox_3',
      checkRunId: 125,
      commentsPosted: 0,
      reviewPostClaimedAt: null,
      costEstimateUsd: '0.00',
      startedAt: new Date('2026-06-17T14:00:00Z'),
      finishedAt: new Date('2026-06-17T14:01:00Z'),
      error: 'Daily review quota reached.',
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
    },
    {
      id: 'run_4',
      runId: 'run_4',
      runKind: 'pull_request_review' as const,
      userId: 1,
      repositoryId: 9001,
      prNumber: 15,
      headSha: 'jkl012',
      prevHeadSha: null,
      patchId: null,
      trigger: 'manual',
      status: 'queued',
      workflowId: null,
      sandboxId: null,
      checkRunId: null,
      commentsPosted: 0,
      reviewPostClaimedAt: null,
      costEstimateUsd: '0.00',
      startedAt: null,
      finishedAt: null,
      error: null,
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
    },
  ],
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
  reviewsEnabled: false,
} satisfies PageData;

describe('/workflow-inspector page', () => {
  afterEach(() => cleanup());

  it('renders recent runs, signals, timers, and child links from persisted runs', async () => {
    render(WorkflowInspectorPage, { data });

    await expect
      .element(page.getByRole('list', { name: 'Recent review runs' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('review-pr:9001:12')).toBeInTheDocument();
    await expect.element(page.getByText('review-run:run_1').first()).toBeInTheDocument();
    await expect.element(page.getByText('review-run:run_4').first()).toBeInTheDocument();
    await expect.element(page.getByText('not started')).toBeInTheDocument();
    expect(document.querySelector('time[datetime=""]')).toBeNull();
    await expect.element(page.getByText('quota_blocked')).toBeInTheDocument();
    await expect.element(page.getByText('Active signals')).toBeInTheDocument();
    await expect.element(page.getByText('Failed or stopped')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Failed or stopped count')).toHaveTextContent('2');
    await expect
      .element(page.getByText('agent-review children visible').first())
      .toBeInTheDocument();
  });
});
