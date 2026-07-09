import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import RunsPage from './+page.svelte';
import type { PageProps } from './$types';

const baseUser = {
  id: 1,
  username: 'testuser',
  name: 'Test User',
  avatarUrl: null,
  email: 'test@example.com',
  isPlatformAdministrator: false,
};

const baseRun = {
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
  status: 'posted',
  workflowId: null,
  sandboxId: 'sandbox_1',
  checkRunId: 123,
  commentsPosted: 2,
  reviewPostClaimedAt: null,
  costEstimateUsd: '1.00',
  startedAt: new Date('2026-06-17T12:00:00Z'),
  finishedAt: new Date('2026-06-17T12:05:00Z'),
  error: null,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
};

describe('/runs page', () => {
  afterEach(() => cleanup());

  it('shows the generic runs subtitle and empty state when no runs exist', async () => {
    const data = {
      user: baseUser,
      reviewsEnabled: true,
      runs: [],
      surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
    } satisfies PageProps['data'];

    render(RunsPage, { data, form: null, params: {} });

    await expect.element(page.getByText('Recent runs')).toBeInTheDocument();
    await expect.element(page.getByText('No runs have started yet.')).toBeInTheDocument();
  });

  it('shows a source column with the pull request review label and trigger', async () => {
    const data = {
      user: baseUser,
      reviewsEnabled: true,
      runs: [baseRun],
      surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
    } satisfies PageProps['data'];

    render(RunsPage, { data, form: null, params: {} });

    await expect.element(page.getByText('Source')).toBeInTheDocument();
    await expect.element(page.getByText('Pull request review')).toBeInTheDocument();
    await expect.element(page.getByText('opened')).toBeInTheDocument();
  });
});
