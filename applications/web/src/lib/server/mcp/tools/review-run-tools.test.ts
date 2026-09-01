import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '@lostgradient/mcp';
import { readToolResultText } from '../tool-result-text';

const mocks = vi.hoisted(() => ({
  listReviewRuns: vi.fn(),
  getReviewRun: vi.fn(),
}));

vi.mock('../readers/review-run-reader', () => ({
  listReviewRuns: mocks.listReviewRuns,
  getReviewRun: mocks.getReviewRun,
}));

import { getReviewRunTool, listReviewRunsTool } from './review-run-tools';

const run = {
  id: 'run-1',
  status: 'posted',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  pullRequestNumber: 7,
  trigger: 'opened',
  headSha: 'abc123',
  costEstimateUsd: 1.25,
  commentsPosted: 2,
  startedAt: '2026-08-01T00:00:00.000Z',
  finishedAt: '2026-08-01T00:05:00.000Z',
};

function context(userId: string): McpContext {
  return {
    userId,
    user: { id: userId, email: 'owner@example.com', name: 'Owner', image: null, role: 'user' },
    signal: new AbortController().signal,
  };
}

describe('list_review_runs', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('returns a page of runs and says when more exist', async () => {
    expect.assertions(2);
    mocks.listReviewRuns.mockResolvedValue({
      items: [run],
      limit: 25,
      offset: 0,
      hasMore: true,
    });

    const result = await listReviewRunsTool.handler({ limit: 25, offset: 0 }, context('7'));

    expect(result.structuredContent).toEqual({
      runs: [run],
      limit: 25,
      offset: 0,
      hasMore: true,
    });
    expect(readToolResultText(result)).toMatch(/more available/);
  });

  it('passes a repository filter through to the reader', async () => {
    expect.assertions(1);
    mocks.listReviewRuns.mockResolvedValue({ items: [], limit: 25, offset: 0, hasMore: false });

    await listReviewRunsTool.handler({ limit: 25, offset: 0, repositoryId: 9002 }, context('7'));

    expect(mocks.listReviewRuns).toHaveBeenCalledWith(7, {
      repositoryId: 9002,
      limit: 25,
      offset: 0,
    });
  });

  it('refuses an unbound subject', async () => {
    expect.assertions(2);

    const result = await listReviewRunsTool.handler({ limit: 25, offset: 0 }, context('abc'));

    expect(result.isError).toBe(true);
    expect(mocks.listReviewRuns).not.toHaveBeenCalled();
  });
});

describe('get_review_run', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('returns one run', async () => {
    expect.assertions(1);
    mocks.getReviewRun.mockResolvedValue(run);

    const result = await getReviewRunTool.handler({ runId: 'run-1' }, context('7'));

    expect(result.structuredContent).toEqual({ run });
  });

  it("reports another account's run as not found", async () => {
    expect.assertions(2);
    mocks.getReviewRun.mockResolvedValue(null);

    const result = await getReviewRunTool.handler({ runId: 'run-theirs' }, context('7'));

    expect(result.isError).toBe(true);
    expect(readToolResultText(result)).toMatch(/No review run with that id/);
  });

  it('refuses an unbound subject', async () => {
    expect.assertions(1);

    const result = await getReviewRunTool.handler({ runId: 'run-1' }, context('-1'));

    expect(result.isError).toBe(true);
  });
});
