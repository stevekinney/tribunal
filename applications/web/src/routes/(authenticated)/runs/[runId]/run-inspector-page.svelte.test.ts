import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import RunInspectorPage from './+page.svelte';
import type { PageData } from './$types';

const user = {
  id: 1,
  username: 'testuser',
  name: 'Test User',
  avatarUrl: null,
  email: 'test@example.com',
  isPlatformAdministrator: false,
};

const data = {
  user,
  run: {
    id: 'run_1',
    userId: 1,
    repositoryId: 9001,
    prNumber: 12,
    headSha: 'abc123',
    prevHeadSha: null,
    trigger: 'opened',
    status: 'running',
    workflowId: null,
    sandboxId: null,
    checkRunId: null,
    commentsPosted: 0,
    costEstimateUsd: '1.00',
    startedAt: new Date('2026-06-17T12:00:00Z'),
    finishedAt: null,
    error: null,
    repositoryOwner: 'lost-gradient',
    repositoryName: 'tribunal',
    agentRuns: [
      {
        id: 'agent_run_1',
        userId: 1,
        reviewRunId: 'run_1',
        agentId: 'agent_security',
        modelUsed: 'sonnet',
        effortUsed: 'xhigh',
        status: 'running',
        findingsCount: 1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheCreationTokens: 1,
        costEstimateUsd: '1.00',
        durationMs: null,
        stoppedReason: null,
        error: null,
        slug: 'security',
        description: 'Finds security issues',
        events: [
          {
            id: 1,
            agentRunId: 'agent_run_1',
            seq: 1,
            kind: 'tool_pre',
            tool: 'Read',
            detail: { denied: true },
            at: new Date('2026-06-17T12:00:01Z'),
          },
        ],
        findings: [
          {
            id: 'finding_1',
            userId: 1,
            agentRunId: 'agent_run_1',
            path: 'src/auth.ts',
            startLine: 10,
            endLine: 10,
            side: 'RIGHT',
            severity: 'warning',
            title: 'Missing authorization check',
            body: 'Add an authorization check.',
            suggestion: null,
            anchored: true,
            githubCommentId: 123,
            fingerprint: 'fingerprint',
            createdAt: new Date('2026-06-17T12:00:02Z'),
          },
        ],
      },
    ],
  },
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
} satisfies PageData;

describe('/runs/[runId] page', () => {
  afterEach(() => cleanup());

  it('renders blocked tool calls and stop control', async () => {
    render(RunInspectorPage, { data });

    await expect.element(page.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    await expect.element(page.getByText('blocked')).toBeInTheDocument();
    await expect.element(page.getByText('Missing authorization check')).toBeInTheDocument();
  });
});
