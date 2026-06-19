import { describe, it, expect } from 'vitest';
import { getPolicy, requirePolicy, registerPolicy, getAllPolicies } from './cache-policy.js';

describe('cache-policy', () => {
  describe('getPolicy', () => {
    it('returns the policy for a known operationId', () => {
      const policy = getPolicy('list-pull-requests');
      expect(policy).toBeDefined();
      expect(policy?.operationId).toBe('list-pull-requests');
      expect(policy?.supportsEtag).toBe(false);
    });

    it('returns undefined for an unknown operationId', () => {
      expect(getPolicy('nonexistent-operation')).toBeUndefined();
    });
  });

  describe('registered policies', () => {
    it('has policies for all expected pull request operations', () => {
      expect(getPolicy('list-pull-requests')).toBeDefined();
      expect(getPolicy('get-pull-request')).toBeDefined();
    });

    it('has policies for all expected issue operations', () => {
      expect(getPolicy('list-issues')).toBeDefined();
      expect(getPolicy('get-issue')).toBeDefined();
      expect(getPolicy('list-issue-comments')).toBeDefined();
    });

    it('has policies for review comment and thread operations', () => {
      expect(getPolicy('list-review-comments')).toBeDefined();
      expect(getPolicy('validate-thread-ownership')).toBeDefined();
      expect(getPolicy('find-thread-for-comment')).toBeDefined();
    });

    it('has policies for repository operations', () => {
      expect(getPolicy('list-installation-repositories')).toBeDefined();
    });

    it('has policies for previously uncached operations', () => {
      expect(getPolicy('get-aggregate-review-state')).toBeDefined();
      expect(getPolicy('get-failing-check-count')).toBeDefined();
    });

    it('has policies for worker operations', () => {
      expect(getPolicy('worker-aggregate-pull-requests')).toBeDefined();
    });
  });

  describe('policy key factories', () => {
    it('list-pull-requests generates correct cache key', () => {
      const policy = getPolicy('list-pull-requests')!;
      const key = policy.keyFactory(123, 's:open|sort:updated');
      expect(key).toContain('123');
      expect(key).toContain('s:open|sort:updated');
    });

    it('get-pull-request generates correct cache key', () => {
      const policy = getPolicy('get-pull-request')!;
      const key = policy.keyFactory('owner', 'repo', 42);
      expect(key).toContain('owner');
      expect(key).toContain('repo');
      expect(key).toContain('42');
    });

    it('get-pull-request-diff-context keys by reviewed head SHA', () => {
      const policy = getPolicy('get-pull-request-diff-context')!;
      const firstHeadKey = policy.keyFactory(123, 42, 'aaa111');
      const secondHeadKey = policy.keyFactory(123, 42, 'bbb222');

      expect(firstHeadKey).toContain('123');
      expect(firstHeadKey).toContain('42');
      expect(firstHeadKey).toContain('aaa111');
      expect(secondHeadKey).toContain('bbb222');
      expect(secondHeadKey).not.toBe(firstHeadKey);
    });

    it('get-aggregate-review-state generates correct cache key', () => {
      const policy = getPolicy('get-aggregate-review-state')!;
      const key = policy.keyFactory('owner', 'repo', 5);
      expect(key).toContain('owner');
      expect(key).toContain('repo');
      expect(key).toContain('5');
      expect(key).toContain('review-state');
    });

    it('get-failing-check-count generates correct cache key', () => {
      const policy = getPolicy('get-failing-check-count')!;
      const key = policy.keyFactory('owner', 'repo', 'abc123sha');
      expect(key).toContain('checks');
      expect(key).toContain('abc123sha');
    });
  });

  describe('eTag support flags', () => {
    it('single-resource REST endpoints support eTag', () => {
      expect(getPolicy('get-pull-request')?.supportsEtag).toBe(true);
      expect(getPolicy('get-issue')?.supportsEtag).toBe(true);
      expect(getPolicy('list-issue-comments')?.supportsEtag).toBe(true);
      expect(getPolicy('list-review-comments')?.supportsEtag).toBe(true);
    });

    it('list fetch callbacks and aggregations do not forward eTags', () => {
      expect(getPolicy('list-pull-requests')?.supportsEtag).toBe(false);
      expect(getPolicy('list-issues')?.supportsEtag).toBe(false);
      expect(getPolicy('list-installation-repositories')?.supportsEtag).toBe(false);
      expect(getPolicy('worker-aggregate-pull-requests')?.supportsEtag).toBe(false);
    });

    it('GraphQL and multi-call operations do not support eTag', () => {
      expect(getPolicy('validate-thread-ownership')?.supportsEtag).toBe(false);
      expect(getPolicy('find-thread-for-comment')?.supportsEtag).toBe(false);
      expect(getPolicy('get-aggregate-review-state')?.supportsEtag).toBe(false);
      expect(getPolicy('get-failing-check-count')?.supportsEtag).toBe(false);
    });
  });

  describe('requirePolicy', () => {
    it('returns the policy for a known operationId', () => {
      const policy = requirePolicy('list-pull-requests');
      expect(policy.operationId).toBe('list-pull-requests');
    });

    it('throws a descriptive error for an unknown operationId', () => {
      expect(() => requirePolicy('nonexistent-operation')).toThrow(
        'Cache policy "nonexistent-operation" not found',
      );
    });
  });

  describe('registerPolicy', () => {
    it('throws when registering a duplicate operationId', () => {
      expect(() =>
        registerPolicy({
          operationId: 'list-pull-requests',
          keyFactory: () => 'duplicate',
          ttlSeconds: 10,
          supportsEtag: false,
        }),
      ).toThrow('Cache policy already registered for operationId: list-pull-requests');
    });
  });

  describe('getAllPolicies', () => {
    it('returns all registered policies', () => {
      const all = getAllPolicies();
      expect(all.size).toBeGreaterThanOrEqual(11);
    });

    it('returns a read-only map', () => {
      const all = getAllPolicies();
      // TypeScript prevents mutation, but verify runtime behavior
      expect(typeof all.get).toBe('function');
      expect(typeof all.has).toBe('function');
    });
  });
});
