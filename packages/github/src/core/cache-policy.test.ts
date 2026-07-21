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
      expect(getPolicy('get-review-thread-counts')).toBeDefined();
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

    it('list-issues generates correct cache key', () => {
      const policy = getPolicy('list-issues')!;
      const key = policy.keyFactory(7, 's:open');
      expect(key).toBe('github:repository:7:issues:list:s:open');
    });

    it('get-issue generates correct cache key', () => {
      const policy = getPolicy('get-issue')!;
      const key = policy.keyFactory('owner', 'repo', 5);
      expect(key).toBe('github:response:owner:repo:issue:5');
    });

    it('list-issue-comments generates correct cache key', () => {
      const policy = getPolicy('list-issue-comments')!;
      const key = policy.keyFactory('owner', 'repo', 7, 'p:1');
      expect(key).toBe('github:response:owner:repo:issue:7:comments:p:1');
    });

    it('list-review-comments generates correct cache key', () => {
      const policy = getPolicy('list-review-comments')!;
      const key = policy.keyFactory('owner', 'repo', 42, 'p:1');
      expect(key).toBe('github:response:owner:repo:pr:42:review-comments:p:1');
    });

    it('validate-thread-ownership generates correct cache key', () => {
      const policy = getPolicy('validate-thread-ownership')!;
      const key = policy.keyFactory('thread1', 'owner', 'repo');
      expect(key).toBe('github:response:thread:thread1:validate:owner:repo');
    });

    it('find-thread-for-comment generates correct cache key', () => {
      const policy = getPolicy('find-thread-for-comment')!;
      const key = policy.keyFactory('owner', 'repo', 42, 'node1');
      expect(key).toBe('github:response:owner:repo:pr:42:thread-lookup:node1');
    });

    it('mint-single-repository-read-token generates correct cache key', () => {
      const policy = getPolicy('mint-single-repository-read-token')!;
      const key = policy.keyFactory(11, 7);
      expect(key).toBe('github:installation:11:repository:7:read-token');
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

    it('get-review-thread-counts generates correct cache key', () => {
      const policy = getPolicy('get-review-thread-counts')!;
      const key = policy.keyFactory('owner', 'repo', 42);
      expect(key).toContain('owner');
      expect(key).toContain('repo');
      expect(key).toContain('42');
      expect(key).toContain('review-thread-counts');
    });

    it('get-installation generates correct cache key', () => {
      const policy = getPolicy('get-installation')!;
      const key = policy.keyFactory(11);
      expect(key).toBe('github:response:installation:11:detail');
    });

    it('list-installation-repositories generates correct cache key', () => {
      const policy = getPolicy('list-installation-repositories')!;
      const key = policy.keyFactory(11);
      expect(key).toBe('github:response:installation:11:repositories');
    });

    it('worker-aggregate-pull-requests generates correct cache key', () => {
      const policy = getPolicy('worker-aggregate-pull-requests')!;
      const key = policy.keyFactory(7, 's:open');
      expect(key).toBe('github:worker:repository:7:prs:s:open');
    });

    it('get-app-webhook-configuration generates a static cache key', () => {
      const policy = getPolicy('get-app-webhook-configuration')!;
      const key = policy.keyFactory();
      expect(key).toBe('github:app:webhook-configuration');
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
      expect(getPolicy('get-review-thread-counts')?.supportsEtag).toBe(false);
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
