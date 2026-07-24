import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import RunInspectorPage from './+page.svelte';
import type { PageData } from './$types';

const invalidateAllMock = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({
  invalidateAll: invalidateAllMock,
}));

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
    sandboxId: null,
    checkRunId: 123456,
    commentsPosted: 0,
    reviewPostClaimedAt: null,
    costEstimateUsd: '1.00',
    startedAt: new Date('2026-06-17T12:00:00Z'),
    finishedAt: null,
    error: null,
    repositoryOwner: 'lost-gradient',
    repositoryName: 'tribunal',
    replacementRunId: null,
    agentRuns: [
      {
        id: 'agent_run_1',
        userId: 1,
        runId: 'run_1',
        agentId: 'agent_security',
        role: 'specialist',
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
          {
            id: 2,
            agentRunId: 'agent_run_1',
            seq: 2,
            kind: 'tool_pre',
            tool: 'Glob',
            detail: { allowed: false },
            at: new Date('2026-06-17T12:00:02Z'),
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
            verificationStatus: 'verified',
            verificationNote: null,
            verifierAgentRunId: null,
            mergedFingerprints: [],
            createdAt: new Date('2026-06-17T12:00:02Z'),
          },
        ],
      },
    ],
  },
  reviewsEnabled: false,
} satisfies PageData;

describe('/runs/[runId] page', () => {
  afterEach(() => {
    cleanup();
    invalidateAllMock.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders blocked tool calls and stop control', async () => {
    render(RunInspectorPage, { data });

    await expect.element(page.getByRole('group', { name: 'Run summary statistics' })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Agents 1' })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Est. cost $1.00' })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Findings 1' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Stop security' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('log', { name: 'security event stream' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Show details' }).first())
      .toBeInTheDocument();
    await expect.element(page.getByText('blocked').first()).toBeInTheDocument();
    await expect.element(page.getByText('tool_pre: Glob blocked')).toBeInTheDocument();
    await expect.element(page.getByText('Missing authorization check')).toBeInTheDocument();
    await expect.element(page.getByText('$1.00')).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Open GitHub Check Run' }))
      .toHaveAttribute('href', 'https://github.com/lost-gradient/tribunal/runs/123456');
    await expect
      .element(page.getByRole('link', { name: 'GitHub comment' }))
      .toHaveAttribute('href', 'https://github.com/lost-gradient/tribunal/pull/12#discussion_r123');
  });

  it('renders webhook event handler context without pull request controls', async () => {
    render(RunInspectorPage, {
      data: {
        ...data,
        run: {
          id: 'run_webhook_1',
          runId: 'run_webhook_1',
          runKind: 'webhook_event_handler',
          userId: 1,
          repositoryId: 9001,
          webhookEventId: 42,
          eventListenerId: 'listener_1',
          deliveryId: 7,
          eventType: 'issues',
          action: 'opened',
          status: 'queued',
          workflowId: null,
          sandboxId: null,
          costEstimateUsd: '0',
          startedAt: new Date('2026-06-17T12:00:00Z'),
          finishedAt: null,
          error: null,
          repositoryOwner: 'lost-gradient',
          repositoryName: 'tribunal',
          replacementRunId: null,
          agentRuns: [],
        },
      },
    });

    await expect.element(page.getByText('lost-gradient/tribunal · issues / opened')).toBeVisible();
    await expect.element(page.getByText('Webhook event')).toBeVisible();
    await expect.element(page.getByText('#42')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Stop run' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Open PR' })).not.toBeInTheDocument();
  });

  it('streams run updates through agent_event transport state', async () => {
    let fallbackRefresh: TimerHandler | undefined;
    const setIntervalSpy = vi.spyOn(window, 'setInterval').mockImplementation((handler) => {
      fallbackRefresh = handler;
      return 123 as never;
    });
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const eventSources: Array<{
      url: string;
      onopen: (() => void) | null;
      onerror: (() => void) | null;
      listeners: Map<string, Array<() => void>>;
      close: () => void;
    }> = [];

    vi.stubGlobal(
      'EventSource',
      class {
        url: string;
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;
        listeners = new Map<string, Array<() => void>>();

        constructor(url: string) {
          this.url = url;
          eventSources.push(this);
        }

        addEventListener(type: string, listener: () => void) {
          this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }

        close = vi.fn();
      },
    );

    const rendered = render(RunInspectorPage, { data });

    expect(eventSources).toHaveLength(1);
    expect(eventSources[0].url).toBe('/api/review/runs/run_1/events?after=2');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    eventSources[0].onopen?.();
    await expect
      .element(page.getByLabelText('Run event stream state'))
      .toHaveTextContent('streaming');

    eventSources[0].listeners.get('agent_event')?.forEach((listener) => listener());
    expect(invalidateAllMock).toHaveBeenCalledOnce();
    expect(fallbackRefresh).toBeTypeOf('function');
    if (typeof fallbackRefresh === 'function') fallbackRefresh();
    expect(invalidateAllMock).toHaveBeenCalledTimes(2);

    await rendered.rerender({
      data: {
        ...data,
        run: {
          ...data.run,
          status: 'posted',
          finishedAt: new Date('2026-06-17T12:00:10Z'),
        },
      },
    });

    expect(eventSources[0].close).toHaveBeenCalledOnce();
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(eventSources).toHaveLength(1);
    await expect
      .element(page.getByLabelText('Run event stream state'))
      .toHaveTextContent('disconnected');
  });

  it('computes the event stream cursor without spreading all event ids', async () => {
    const manyEvents = Array.from({ length: 10_000 }, (_, index) => ({
      ...data.run.agentRuns[0].events[0],
      id: index + 1,
      seq: index + 1,
    }));
    const eventSources: Array<{ url: string }> = [];

    vi.stubGlobal(
      'EventSource',
      class {
        url: string;
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;

        constructor(url: string) {
          this.url = url;
          eventSources.push(this);
        }

        addEventListener() {}

        close = vi.fn();
      },
    );

    render(RunInspectorPage, {
      data: {
        ...data,
        run: {
          ...data.run,
          agentRuns: [
            {
              ...data.run.agentRuns[0],
              events: manyEvents,
            },
          ],
        },
      },
    });

    expect(eventSources[0]?.url).toBe('/api/review/runs/run_1/events?after=10000');
  });

  it('links superseded runs to their replacement run', async () => {
    render(RunInspectorPage, {
      data: {
        ...data,
        run: {
          ...data.run,
          status: 'superseded',
          replacementRunId: 'run_2',
        },
      },
    });

    await expect
      .element(page.getByRole('link', { name: 'Superseded by a newer run' }))
      .toHaveAttribute('href', '/runs/run_2');
  });

  it('shows a plain label for a superseded run with no known replacement', async () => {
    render(RunInspectorPage, {
      data: {
        ...data,
        run: {
          ...data.run,
          status: 'superseded',
          replacementRunId: null,
        },
      },
    });

    await expect.element(page.getByText('Superseded by a newer run')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Superseded by a newer run' }))
      .not.toBeInTheDocument();
  });

  it('shows a top-level alert when the run recorded an error', async () => {
    render(RunInspectorPage, {
      data: { ...data, run: { ...data.run, error: 'The sandbox crashed unexpectedly.' } },
    });

    await expect.element(page.getByText('The sandbox crashed unexpectedly.')).toBeVisible();
  });

  it('shows a dash for the check run stat when no check run id is recorded', async () => {
    render(RunInspectorPage, {
      data: { ...data, run: { ...data.run, checkRunId: null } },
    });

    await expect.element(page.getByText('—')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Open GitHub Check Run' }))
      .not.toBeInTheDocument();
  });

  it('classifies a non-tool_pre event by its kind and falls back to info', async () => {
    render(RunInspectorPage, {
      data: {
        ...data,
        run: {
          ...data.run,
          agentRuns: [
            {
              ...data.run.agentRuns[0],
              events: [
                { ...data.run.agentRuns[0].events[0], kind: 'run_failed', tool: null },
                { ...data.run.agentRuns[0].events[1], kind: 'log', tool: null },
              ],
            },
          ],
        },
      },
    });

    await expect.element(page.getByText('run_failed').first()).toBeInTheDocument();
    await expect.element(page.getByText('log').first()).toBeInTheDocument();
  });

  it('renders run status, agent status, and finding severity badges across their full range', async () => {
    render(RunInspectorPage, {
      data: {
        ...data,
        run: {
          ...data.run,
          status: 'failed',
          agentRuns: [
            {
              ...data.run.agentRuns[0],
              id: 'agent_run_1',
              status: 'succeeded',
              durationMs: 65_000,
              findings: [
                { ...data.run.agentRuns[0].findings[0], id: 'finding_error', severity: 'error' },
                { ...data.run.agentRuns[0].findings[0], id: 'finding_note', severity: 'note' },
              ],
            },
            { ...data.run.agentRuns[0], id: 'agent_run_2', status: 'queued', findings: [] },
            { ...data.run.agentRuns[0], id: 'agent_run_3', status: 'stopped', findings: [] },
            { ...data.run.agentRuns[0], id: 'agent_run_4', status: 'failed', findings: [] },
          ],
        },
      },
    });

    await expect.element(page.getByText('Failed').first()).toBeVisible();
    await expect.element(page.getByText('Succeeded')).toBeVisible();
    await expect.element(page.getByText('Queued')).toBeVisible();
    await expect.element(page.getByText('Stopped')).toBeVisible();
    await expect.element(page.getByText('Error').first()).toBeVisible();
    await expect.element(page.getByText('Note')).toBeVisible();
    // durationMs=65_000 formats as "1m 5s" via formatDurationMs/agentMetaSummary.
    await expect.element(page.getByText('1m 5s')).toBeVisible();
    // agent_run_2 and agent_run_3 have no findings recorded.
    await expect.element(page.getByText('No findings recorded.').first()).toBeVisible();
  });

  it('quota-blocked runs render a warning status badge', async () => {
    render(RunInspectorPage, {
      data: { ...data, run: { ...data.run, status: 'quota_blocked' } },
    });

    await expect.element(page.getByText('Quota blocked')).toBeVisible();
  });

  it('falls back to a disconnected stream when EventSource is unavailable', async () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    vi.stubGlobal('EventSource', undefined);

    const rendered = render(RunInspectorPage, { data });

    await expect
      .element(page.getByLabelText('Run event stream state'))
      .toHaveTextContent('disconnected');

    rendered.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('ignores late onopen/onerror callbacks after the stream is torn down', async () => {
    const eventSources: Array<{
      url: string;
      onopen: (() => void) | null;
      onerror: (() => void) | null;
      close: () => void;
    }> = [];

    vi.stubGlobal(
      'EventSource',
      class {
        url: string;
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;

        constructor(url: string) {
          this.url = url;
          eventSources.push(this);
        }

        addEventListener() {}

        close = vi.fn();
      },
    );

    const rendered = render(RunInspectorPage, { data });
    const source = eventSources[0];

    // Trigger the live onerror path first (connectionState -> disconnected).
    source.onerror?.();
    await expect
      .element(page.getByLabelText('Run event stream state'))
      .toHaveTextContent('disconnected');

    // Tearing the run down (no longer stoppable) closes the stream and flips
    // streamIsActive to false, so late callbacks on the stale EventSource
    // must be no-ops.
    await rendered.rerender({ data: { ...data, run: { ...data.run, status: 'posted' } } });
    expect(source.close).toHaveBeenCalledOnce();

    source.onopen?.();
    source.onerror?.();
    await expect
      .element(page.getByLabelText('Run event stream state'))
      .toHaveTextContent('disconnected');
  });
});
