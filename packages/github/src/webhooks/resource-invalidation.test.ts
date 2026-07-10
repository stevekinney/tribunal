import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CACHE_KEYS } from '../cache-keys.js';
import type { GithubServiceContext } from '../context.js';

// Mock repository lookup
const mockGetRepositoryByOwnerAndName = vi.fn().mockResolvedValue(null);

vi.mock('../repositories/service.js', () => ({
  getRepositoryByOwnerAndName: (...args: unknown[]) => mockGetRepositoryByOwnerAndName(...args),
}));

// Import after mocking
const { invalidateGitHubResourceCacheForEvent } = await import('./resource-invalidation.js');

// ============================================================================
// Test helpers
// ============================================================================

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

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      id: 12345,
      owner: { login: 'acme' },
      name: 'widgets',
      full_name: 'acme/widgets',
    },
    installation: { id: 999 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('invalidateGitHubResourceCacheForEvent', () => {
  let context: GithubServiceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
  });

  // --------------------------------------------------------------------------
  // issues
  // --------------------------------------------------------------------------
  describe('issues events', () => {
    it('invalidates issue detail, issue pattern, and list caches', async () => {
      const data = makePayload({ action: 'opened', issue: { number: 42 } });
      mockGetRepositoryByOwnerAndName.mockResolvedValueOnce({ id: 12345 });

      await invalidateGitHubResourceCacheForEvent(context, 'issues', 'opened', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_ISSUE_DETAIL('acme', 'widgets', 42),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_ISSUE_PATTERN('acme', 'widgets', 42),
      );
      // Existing list caches via DB lookup
      expect(mockGetRepositoryByOwnerAndName).toHaveBeenCalledWith(context, 'acme', 'widgets');
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_ISSUES_LIST_PATTERN(12345),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PRS_LIST_PATTERN(12345),
      );
    });

    it('skips list cache invalidation when repository is not tracked', async () => {
      const data = makePayload({ action: 'closed', issue: { number: 7 } });
      mockGetRepositoryByOwnerAndName.mockResolvedValueOnce(null);

      await invalidateGitHubResourceCacheForEvent(context, 'issues', 'closed', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_ISSUE_DETAIL('acme', 'widgets', 7),
      );
      // DB lookup happens but no list cache invalidation
      expect(mockGetRepositoryByOwnerAndName).toHaveBeenCalled();
    });

    it('does nothing when issue number is missing', async () => {
      const data = makePayload({ action: 'opened' });

      await invalidateGitHubResourceCacheForEvent(context, 'issues', 'opened', data);

      expect(context.cache.deleteCache).not.toHaveBeenCalled();
      expect(context.cache.deleteCacheByPattern).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // issue_comment
  // --------------------------------------------------------------------------
  describe('issue_comment events', () => {
    it('invalidates issue detail and comment pattern for regular issues', async () => {
      const data = makePayload({
        action: 'created',
        issue: { number: 10 },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'issue_comment', 'created', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_ISSUE_DETAIL('acme', 'widgets', 10),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_ISSUE_PATTERN('acme', 'widgets', 10),
      );
      // Should not invalidate PR detail for regular issues
      expect(context.cache.deleteCache).not.toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 10),
      );
    });

    it('also invalidates PR detail when issue is a pull request', async () => {
      const data = makePayload({
        action: 'created',
        issue: { number: 10, pull_request: { url: 'https://...' } },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'issue_comment', 'created', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_ISSUE_DETAIL('acme', 'widgets', 10),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_ISSUE_PATTERN('acme', 'widgets', 10),
      );
      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 10),
      );
    });
  });

  // --------------------------------------------------------------------------
  // pull_request
  // --------------------------------------------------------------------------
  describe('pull_request events', () => {
    it('invalidates PR detail, PR pattern, and list caches', async () => {
      const data = makePayload({
        action: 'opened',
        pull_request: { number: 5 },
      });
      mockGetRepositoryByOwnerAndName.mockResolvedValueOnce({ id: 12345 });

      await invalidateGitHubResourceCacheForEvent(context, 'pull_request', 'opened', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 5),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN('acme', 'widgets', 5),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_ISSUES_LIST_PATTERN(12345),
      );
    });
  });

  // --------------------------------------------------------------------------
  // pull_request_review
  // --------------------------------------------------------------------------
  describe('pull_request_review events', () => {
    it('invalidates PR detail, PR pattern, and review state cache', async () => {
      const data = makePayload({
        action: 'submitted',
        pull_request: { number: 8 },
      });

      await invalidateGitHubResourceCacheForEvent(
        context,
        'pull_request_review',
        'submitted',
        data,
      );

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 8),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN('acme', 'widgets', 8),
      );
      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_REVIEW_STATE('acme', 'widgets', 8),
      );
    });
  });

  // --------------------------------------------------------------------------
  // pull_request_review_comment
  // --------------------------------------------------------------------------
  describe('pull_request_review_comment events', () => {
    it('invalidates review comments pattern, PR detail, and review state', async () => {
      const data = makePayload({
        action: 'created',
        pull_request: { number: 3 },
      });

      await invalidateGitHubResourceCacheForEvent(
        context,
        'pull_request_review_comment',
        'created',
        data,
      );

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 3),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN('acme', 'widgets', 3),
      );
      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_REVIEW_STATE('acme', 'widgets', 3),
      );
    });
  });

  // --------------------------------------------------------------------------
  // pull_request_review_thread
  // --------------------------------------------------------------------------
  describe('pull_request_review_thread events', () => {
    it('invalidates thread validate cache, PR detail, and PR pattern', async () => {
      const data = makePayload({
        action: 'resolved',
        pull_request: { number: 15 },
        thread: { id: 12345, node_id: 'PRRT_abc123' },
      });

      await invalidateGitHubResourceCacheForEvent(
        context,
        'pull_request_review_thread',
        'resolved',
        data,
      );

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 15),
      );
      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_REVIEW_THREAD_VALIDATE('PRRT_abc123', 'acme', 'widgets'),
      );
      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN('acme', 'widgets', 15),
      );
    });

    it('skips thread validate cache when thread ID is missing', async () => {
      const data = makePayload({
        action: 'resolved',
        pull_request: { number: 15 },
      });

      await invalidateGitHubResourceCacheForEvent(
        context,
        'pull_request_review_thread',
        'resolved',
        data,
      );

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_PR_DETAIL('acme', 'widgets', 15),
      );
      // Thread validate should not be called
      expect(context.cache.deleteCache).not.toHaveBeenCalledWith(
        expect.stringContaining('thread:'),
      );
    });
  });

  // --------------------------------------------------------------------------
  // installation_repositories
  // --------------------------------------------------------------------------
  describe('installation_repositories events', () => {
    it('invalidates installation repositories cache', async () => {
      const data = makePayload({ action: 'added' });

      await invalidateGitHubResourceCacheForEvent(
        context,
        'installation_repositories',
        'added',
        data,
      );

      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_INSTALLATION_PATTERN(999),
      );
    });
  });

  // --------------------------------------------------------------------------
  // repository
  // --------------------------------------------------------------------------
  describe('repository events', () => {
    it('invalidates entire repo pattern', async () => {
      const data = makePayload({ action: 'transferred' });

      await invalidateGitHubResourceCacheForEvent(context, 'repository', 'transferred', data);

      expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_RESPONSE_REPO_PATTERN('acme', 'widgets'),
      );
    });
  });

  // --------------------------------------------------------------------------
  // check_run / check_suite
  // --------------------------------------------------------------------------
  describe('check_run events', () => {
    it('invalidates check counts cache by head_sha', async () => {
      const data = makePayload({
        action: 'completed',
        check_run: {
          head_sha: 'abc123sha',
          pull_requests: [{ number: 10 }],
        },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'check_run', 'completed', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_CHECK_COUNTS('acme', 'widgets', 'abc123sha'),
      );
    });

    it('invalidates only check counts when no pull_requests are associated', async () => {
      const data = makePayload({
        action: 'completed',
        check_run: { head_sha: 'def456sha' },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'check_run', 'completed', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_CHECK_COUNTS('acme', 'widgets', 'def456sha'),
      );
      // No PR-specific invalidation
      expect(context.cache.deleteCache).not.toHaveBeenCalledWith(
        expect.stringContaining('action-item-counts'),
      );
    });

    it('invalidates the branch CI cache using check_run.check_suite.head_branch', async () => {
      const data = makePayload({
        action: 'completed',
        check_run: {
          head_sha: 'abc123sha',
          check_suite: { head_branch: 'main' },
        },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'check_run', 'completed', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_BRANCH_CI_STATUS('acme', 'widgets', 'main'),
      );
    });

    it('does not attempt branch CI invalidation when head_branch is missing', async () => {
      const data = makePayload({
        action: 'completed',
        check_run: { head_sha: 'def456sha' },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'check_run', 'completed', data);

      expect(context.cache.deleteCache).not.toHaveBeenCalledWith(
        expect.stringContaining('branch:'),
      );
    });
  });

  describe('check_suite events', () => {
    it('invalidates check counts cache for check_suite with head_sha', async () => {
      const data = makePayload({
        action: 'completed',
        check_suite: {
          head_sha: 'suite789sha',
          pull_requests: [{ number: 20 }, { number: 21 }],
        },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'check_suite', 'completed', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_CHECK_COUNTS('acme', 'widgets', 'suite789sha'),
      );
    });

    it('invalidates the branch CI cache using check_suite.head_branch', async () => {
      const data = makePayload({
        action: 'completed',
        check_suite: {
          head_sha: 'suite789sha',
          head_branch: 'feature/phase-two',
        },
      });

      await invalidateGitHubResourceCacheForEvent(context, 'check_suite', 'completed', data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_BRANCH_CI_STATUS('acme', 'widgets', 'feature/phase-two'),
      );
    });
  });

  // --------------------------------------------------------------------------
  // status (legacy commit status contexts, e.g. Statuses API CI)
  // --------------------------------------------------------------------------
  describe('status events', () => {
    it('invalidates check counts cache by sha', async () => {
      const data = makePayload({
        sha: 'statussha123',
        branches: [],
      });

      await invalidateGitHubResourceCacheForEvent(context, 'status', null, data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_CHECK_COUNTS('acme', 'widgets', 'statussha123'),
      );
    });

    it('invalidates the branch CI cache for every branch the status commit is head of', async () => {
      const data = makePayload({
        sha: 'statussha123',
        branches: [{ name: 'main' }, { name: 'feature/phase-two' }],
      });

      await invalidateGitHubResourceCacheForEvent(context, 'status', null, data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_BRANCH_CI_STATUS('acme', 'widgets', 'main'),
      );
      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_BRANCH_CI_STATUS('acme', 'widgets', 'feature/phase-two'),
      );
    });

    it('does not attempt branch CI invalidation when branches is empty', async () => {
      const data = makePayload({ sha: 'statussha123', branches: [] });

      await invalidateGitHubResourceCacheForEvent(context, 'status', null, data);

      expect(context.cache.deleteCache).not.toHaveBeenCalledWith(
        expect.stringContaining('branch:'),
      );
    });
  });

  // --------------------------------------------------------------------------
  // push (branch-head-sha cache used by the dashboard when `repository.commit`
  // hasn't been populated yet)
  // --------------------------------------------------------------------------
  describe('push events', () => {
    it('invalidates the cached branch head SHA for the pushed branch', async () => {
      const data = makePayload({ ref: 'refs/heads/main', after: 'newsha123' });

      await invalidateGitHubResourceCacheForEvent(context, 'push', null, data);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        CACHE_KEYS.GITHUB_BRANCH_HEAD_SHA('acme', 'widgets', 'main'),
      );
    });

    it('does not invalidate for tag pushes', async () => {
      const data = makePayload({ ref: 'refs/tags/v1.0.0', after: 'newsha123' });

      await invalidateGitHubResourceCacheForEvent(context, 'push', null, data);

      expect(context.cache.deleteCache).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Unrelated events
  // --------------------------------------------------------------------------
  describe('unrelated events', () => {
    it.each(['deployment'])('does not invalidate for %s events', async (eventType) => {
      const data = makePayload({ action: 'completed' });

      await invalidateGitHubResourceCacheForEvent(context, eventType, 'completed', data);

      expect(context.cache.deleteCache).not.toHaveBeenCalled();
      expect(context.cache.deleteCacheByPattern).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Error resilience
  // --------------------------------------------------------------------------
  describe('error resilience', () => {
    it('does not throw when deleteCache fails', async () => {
      vi.mocked(context.cache.deleteCache).mockRejectedValueOnce(new Error('Redis down'));
      const data = makePayload({ action: 'opened', issue: { number: 1 } });

      // Should not throw
      await expect(
        invalidateGitHubResourceCacheForEvent(context, 'issues', 'opened', data),
      ).resolves.toBeUndefined();
    });

    it('does not throw when repository lookup fails', async () => {
      mockGetRepositoryByOwnerAndName.mockRejectedValueOnce(new Error('DB down'));
      const data = makePayload({ action: 'opened', issue: { number: 1 } });

      await expect(
        invalidateGitHubResourceCacheForEvent(context, 'issues', 'opened', data),
      ).resolves.toBeUndefined();
    });

    it('handles missing repository in payload', async () => {
      const data = { action: 'opened', issue: { number: 1 } };

      await expect(
        invalidateGitHubResourceCacheForEvent(context, 'issues', 'opened', data),
      ).resolves.toBeUndefined();

      expect(context.cache.deleteCache).not.toHaveBeenCalled();
    });
  });
});
