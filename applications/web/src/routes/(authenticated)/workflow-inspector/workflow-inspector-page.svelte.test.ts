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
      userId: 1,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      prevHeadSha: null,
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
      userId: 1,
      repositoryId: 9001,
      prNumber: 13,
      headSha: 'def456',
      prevHeadSha: null,
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
  ],
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
} satisfies PageData;

describe('/workflow-inspector page', () => {
  afterEach(() => cleanup());

  it('renders workflow steps, signals, timers, and child links from persisted runs', async () => {
    render(WorkflowInspectorPage, { data });

    await expect.element(page.getByText('review-pr:9001:12')).toBeInTheDocument();
    await expect.element(page.getByText('review-run:run_1').first()).toBeInTheDocument();
    await expect.element(page.getByText('Active signals')).toBeInTheDocument();
    await expect.element(page.getByText('Failed or stopped')).toBeInTheDocument();
    await expect
      .element(page.getByText('agent-review children visible').first())
      .toBeInTheDocument();
  });
});
