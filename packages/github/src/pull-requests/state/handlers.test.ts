import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GithubServiceContext } from '../../context.js';
import {
  handlePullRequestStateUpdate,
  handleReviewStateUpdate,
  handleCheckSuiteCompleted,
} from './handlers.js';

vi.mock('./state.js', () => ({
  upsertPRState: vi.fn().mockResolvedValue({
    id: 1,
    repositoryId: 100,
    prNumber: 1,
    state: 'open',
    isDraft: false,
    isMerged: false,
    headSha: 'abc',
    baseSha: 'def',
    baseRef: 'main',
    ciStatus: 'unknown',
    failingCheckCount: 0,
    ciUpdatedAt: null,
    reviewStatus: 'unknown',
    approvalCount: 0,
    changesRequestedCount: 0,
    unresolvedThreadCount: 0,
    reviewUpdatedAt: null,
    mergeStatus: 'unknown',
    mergeUpdatedAt: null,
    automationStatus: 'idle',
    attemptCount: 0,
    lastErrorMessage: null,
    isPaused: false,
    prUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));

vi.mock('./queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./queries.js')>()),
  getAggregateReviewState: vi.fn().mockResolvedValue({
    reviewStatus: 'approved',
    approvalCount: 1,
    changesRequestedCount: 0,
    unresolvedThreadCount: 0,
  }),
  getFailingCheckCount: vi.fn().mockResolvedValue({
    ciStatus: 'passing',
    failingCount: 0,
  }),
}));

const { upsertPRState } = await import('./state.js');
const { getAggregateReviewState, getFailingCheckCount } = await import('./queries.js');

const mockOctokit = {} as any;

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as any,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handlePullRequestStateUpdate', () => {
  const basePayload = {
    pull_request: {
      number: 42,
      state: 'open',
      draft: false,
      merged: false,
      head: { sha: 'head123' },
      base: { sha: 'base456', ref: 'main' },
      updated_at: '2024-01-15T10:00:00Z',
    },
    repository: { id: 100, owner: { login: 'test-org' }, name: 'test-repo' },
  };

  it('calls upsertPRState for opened action', async () => {
    const context = createMockContext();
    await handlePullRequestStateUpdate(context, basePayload, 'opened');
    expect(upsertPRState).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        repositoryId: 100,
        prNumber: 42,
        state: 'open',
        isDraft: false,
        isMerged: false,
        headSha: 'head123',
      }),
    );
  });

  it('detects merged PR', async () => {
    const context = createMockContext();
    const payload = {
      ...basePayload,
      pull_request: { ...basePayload.pull_request, state: 'closed', merged: true },
    };
    await handlePullRequestStateUpdate(context, payload, 'closed');
    expect(upsertPRState).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ isMerged: true, state: 'closed' }),
    );
  });

  it('ignores irrelevant actions', async () => {
    const context = createMockContext();
    await handlePullRequestStateUpdate(context, basePayload, 'labeled');
    expect(upsertPRState).not.toHaveBeenCalled();
  });

  it('handles converted_to_draft', async () => {
    const context = createMockContext();
    const payload = {
      ...basePayload,
      pull_request: { ...basePayload.pull_request, draft: true },
    };
    await handlePullRequestStateUpdate(context, payload, 'converted_to_draft');
    expect(upsertPRState).toHaveBeenCalledWith(context, expect.objectContaining({ isDraft: true }));
  });
});

describe('handleReviewStateUpdate', () => {
  const payload = {
    review: { submitted_at: '2024-01-15T10:00:00Z' },
    pull_request: { number: 42, head: { sha: 'head123' } },
    repository: { id: 100, owner: { login: 'test-org' }, name: 'test-repo' },
  };

  it('calls getAggregateReviewState and upserts', async () => {
    const context = createMockContext();
    await handleReviewStateUpdate(context, payload, mockOctokit);
    expect(getAggregateReviewState).toHaveBeenCalledWith(
      context,
      mockOctokit,
      'test-org',
      'test-repo',
      42,
    );
    expect(upsertPRState).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        repositoryId: 100,
        prNumber: 42,
        reviewStatus: 'approved',
        approvalCount: 1,
      }),
    );
  });
});

describe('handleCheckSuiteCompleted', () => {
  it('calls getFailingCheckCount and upserts for each PR', async () => {
    const context = createMockContext();
    const payload = {
      check_suite: {
        head_sha: 'sha123',
        updated_at: '2024-01-15T10:00:00Z',
        pull_requests: [{ number: 42 }, { number: 43 }],
      },
      repository: { id: 100, owner: { login: 'test-org' }, name: 'test-repo' },
    };

    await handleCheckSuiteCompleted(context, payload, mockOctokit);
    expect(getFailingCheckCount).toHaveBeenCalledWith(
      context,
      mockOctokit,
      'test-org',
      'test-repo',
      'sha123',
    );
    expect(upsertPRState).toHaveBeenCalledTimes(2);
  });

  it('skips if no PRs associated', async () => {
    const context = createMockContext();
    const payload = {
      check_suite: {
        head_sha: 'sha123',
        pull_requests: [],
      },
      repository: { id: 100, owner: { login: 'test-org' }, name: 'test-repo' },
    };

    await handleCheckSuiteCompleted(context, payload, mockOctokit);
    expect(getFailingCheckCount).not.toHaveBeenCalled();
  });
});
