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
    userId: 1,
    repositoryId: 9001,
    prNumber: 12,
    headSha: 'abc123',
    prevHeadSha: null,
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
});
