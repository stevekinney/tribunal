import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpReviewRun } from '../readers/review-run-reader';

vi.mock('../readers/review-run-reader', () => ({ listReviewRuns: vi.fn() }));

import { listReviewRuns } from '../readers/review-run-reader';
import { reviewRunsResource } from './review-run-resource';

afterEach(() => vi.clearAllMocks());

const run: McpReviewRun = {
  id: 'run-1',
  status: 'running',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  pullRequestNumber: 412,
  costEstimateUsd: 1.25,
  startedAt: '2026-08-01T00:00:00.000Z',
  finishedAt: null,
};

/** A minimal McpContext with the given opaque subject id. */
function context(userId: string) {
  return {
    userId,
    user: { id: userId, email: 'e@example.com', name: 'n', image: null, role: 'user' },
    signal: new AbortController().signal,
  } as never;
}

describe('review-runs resource (TRI-126)', () => {
  it('reads the caller runs as a JSON document at the resource URI', async () => {
    vi.mocked(listReviewRuns).mockResolvedValue({
      items: [run],
      limit: 25,
      offset: 0,
      hasMore: false,
    });

    const result = await reviewRunsResource.handler(
      new URL('tribunal://review-runs'),
      context('5'),
    );

    expect(listReviewRuns).toHaveBeenCalledWith(5, { limit: 25, offset: 0 });
    const content = result.contents[0]!;
    expect(content.uri).toBe('tribunal://review-runs');
    expect(content.mimeType).toBe('application/json');
    const parsed = JSON.parse((content as { text: string }).text) as {
      runs: McpReviewRun[];
      hasMore: boolean;
    };
    expect(parsed.runs[0]!.id).toBe('run-1');
    expect(parsed.hasMore).toBe(false);
  });

  it('is scoped to reviews:read', () => {
    expect(reviewRunsResource.requiredScope).toBe('reviews:read');
  });

  it('throws rather than answering when the subject does not resolve to a Tribunal user', async () => {
    await expect(
      reviewRunsResource.handler(new URL('tribunal://review-runs'), context('not-an-integer')),
    ).rejects.toThrow('unresolved subject');
    expect(listReviewRuns).not.toHaveBeenCalled();
  });
});
