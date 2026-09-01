import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '@lostgradient/mcp';
import { readToolResultText } from '../tool-result-text';

const mocks = vi.hoisted(() => ({
  listCostEvents: vi.fn(),
  summarizeCostEvents: vi.fn(),
}));

vi.mock('../readers/cost-event-reader', () => ({
  listCostEvents: mocks.listCostEvents,
  summarizeCostEvents: mocks.summarizeCostEvents,
}));

import { getCostSummaryTool, listCostEventsTool } from './cost-tools';

const costEvent = {
  occurredAt: '2026-08-01T00:00:00.000Z',
  amountUsd: 2.5,
  source: 'estimate',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  agentSlug: 'security',
  reviewRunId: 'run-1',
};

function context(userId: string): McpContext {
  return {
    userId,
    user: { id: userId, email: 'owner@example.com', name: 'Owner', image: null, role: 'user' },
    signal: new AbortController().signal,
  };
}

describe('list_cost_events', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('returns a page of ledger rows', async () => {
    expect.assertions(2);
    mocks.listCostEvents.mockResolvedValue({
      items: [costEvent],
      limit: 25,
      offset: 0,
      hasMore: false,
    });

    const result = await listCostEventsTool.handler({ limit: 25, offset: 0 }, context('7'));

    expect(result.structuredContent).toEqual({
      costEvents: [costEvent],
      limit: 25,
      offset: 0,
      hasMore: false,
    });
    expect(readToolResultText(result)).toMatch(/Untrusted content/);
  });

  it('passes a source filter through to the reader', async () => {
    expect.assertions(1);
    mocks.listCostEvents.mockResolvedValue({ items: [], limit: 25, offset: 0, hasMore: true });

    await listCostEventsTool.handler({ limit: 25, offset: 0, source: 'reconciled' }, context('7'));

    expect(mocks.listCostEvents).toHaveBeenCalledWith(7, {
      source: 'reconciled',
      limit: 25,
      offset: 0,
    });
  });

  it('refuses an unbound subject', async () => {
    expect.assertions(2);

    const result = await listCostEventsTool.handler({ limit: 25, offset: 0 }, context('0x10'));

    expect(result.isError).toBe(true);
    expect(mocks.listCostEvents).not.toHaveBeenCalled();
  });
});

describe('get_cost_summary', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('returns the rolled-up summary', async () => {
    expect.assertions(2);
    const summary = {
      source: 'estimate' as const,
      windowDays: 7,
      since: '2026-07-25T00:00:00.000Z',
      eventCount: 2,
      totalUsd: 4,
      byRepository: [{ label: 'lost-gradient/tribunal', amountUsd: 4 }],
      byAgent: [{ label: 'security', amountUsd: 4 }],
    };
    mocks.summarizeCostEvents.mockResolvedValue(summary);

    const result = await getCostSummaryTool.handler(
      { source: 'estimate', windowDays: 7 },
      context('7'),
    );

    expect(result.structuredContent).toEqual(summary);
    expect(readToolResultText(result)).toMatch(/4 USD over 7 days/);
  });

  it('refuses an unbound subject', async () => {
    expect.assertions(2);

    const result = await getCostSummaryTool.handler(
      { source: 'estimate', windowDays: 30 },
      context(' 7 '),
    );

    expect(result.isError).toBe(true);
    expect(mocks.summarizeCostEvents).not.toHaveBeenCalled();
  });
});
