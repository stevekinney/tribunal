import { describe, expect, it } from 'vitest';
import { CACHE_KEYS } from './cache-keys.js';

describe('CACHE_KEYS', () => {
  it('builds GitHub access keys and wildcard patterns', () => {
    expect.assertions(3);
    expect(CACHE_KEYS.GITHUB_ACCESS(1, 2)).toBe('github-access:1:2');
    expect(CACHE_KEYS.GITHUB_ACCESS_USER_PATTERN(1)).toBe('github-access:1:*');
    expect(CACHE_KEYS.GITHUB_ACCESS_REPO_PATTERN(2)).toBe('github-access:*:2');
  });

  it('builds GitHub issues list keys and their invalidation pattern', () => {
    expect.assertions(2);
    expect(CACHE_KEYS.GITHUB_ISSUES_LIST(7, 's:open')).toBe(
      'github:repository:7:issues:list:s:open',
    );
    expect(CACHE_KEYS.GITHUB_ISSUES_LIST_PATTERN(7)).toBe('github:repository:7:issues:list:*');
  });

  it('builds GitHub PR list keys and their invalidation pattern', () => {
    expect.assertions(2);
    expect(CACHE_KEYS.GITHUB_PRS_LIST(7, 's:open')).toBe('github:repository:7:prs:list:s:open');
    expect(CACHE_KEYS.GITHUB_PRS_LIST_PATTERN(7)).toBe('github:repository:7:prs:list:*');
  });

  it('builds issue detail and comment list keys', () => {
    expect.assertions(2);
    expect(CACHE_KEYS.GITHUB_ISSUE_DETAIL('octo', 'repo', 5)).toBe(
      'github:response:octo:repo:issue:5',
    );
    expect(CACHE_KEYS.GITHUB_ISSUE_COMMENTS_LIST('octo', 'repo', 5, 'p:1')).toBe(
      'github:response:octo:repo:issue:5:comments:p:1',
    );
  });

  it('builds PR detail and diff context keys', () => {
    expect.assertions(2);
    expect(CACHE_KEYS.GITHUB_PR_DETAIL('octo', 'repo', 9)).toBe('github:response:octo:repo:pr:9');
    expect(CACHE_KEYS.GITHUB_PR_DIFF_CONTEXT(3, 9, 'sha123')).toBe(
      'github:response:repository:3:pr:9:head:sha123:diff-context',
    );
  });

  it('builds review comments list, thread lookup, and thread validate keys', () => {
    expect.assertions(3);
    expect(CACHE_KEYS.GITHUB_REVIEW_COMMENTS_LIST('octo', 'repo', 9, 'p:1')).toBe(
      'github:response:octo:repo:pr:9:review-comments:p:1',
    );
    expect(CACHE_KEYS.GITHUB_REVIEW_THREAD_LOOKUP('octo', 'repo', 9, 'node123')).toBe(
      'github:response:octo:repo:pr:9:thread-lookup:node123',
    );
    expect(CACHE_KEYS.GITHUB_REVIEW_THREAD_VALIDATE('thread1', 'octo', 'repo')).toBe(
      'github:response:thread:thread1:validate:octo:repo',
    );
  });

  it('builds installation detail and repositories keys', () => {
    expect.assertions(2);
    expect(CACHE_KEYS.GITHUB_INSTALLATION_DETAIL(11)).toBe(
      'github:response:installation:11:detail',
    );
    expect(CACHE_KEYS.GITHUB_INSTALLATION_REPOSITORIES(11)).toBe(
      'github:response:installation:11:repositories',
    );
  });

  it('builds review state, thread counts, and CI check keys', () => {
    expect.assertions(3);
    expect(CACHE_KEYS.GITHUB_REVIEW_STATE('octo', 'repo', 9)).toBe(
      'github:response:octo:repo:pr:9:review-state',
    );
    expect(CACHE_KEYS.GITHUB_REVIEW_THREAD_COUNTS('octo', 'repo', 9)).toBe(
      'github:response:octo:repo:pr:9:review-thread-counts',
    );
    expect(CACHE_KEYS.GITHUB_CHECK_COUNTS('octo', 'repo', 'sha123')).toBe(
      'github:response:octo:repo:checks:sha123',
    );
  });

  it('builds branch CI status, head sha, and rules keys', () => {
    expect.assertions(3);
    expect(CACHE_KEYS.GITHUB_BRANCH_CI_STATUS('octo', 'repo', 'main')).toBe(
      'github:response:octo:repo:branch:main:ci-status',
    );
    expect(CACHE_KEYS.GITHUB_BRANCH_HEAD_SHA('octo', 'repo', 'main')).toBe(
      'github:response:octo:repo:branch:main:head-sha',
    );
    expect(CACHE_KEYS.GITHUB_BRANCH_RULES('octo', 'repo', 'main')).toBe(
      'github:response:octo:repo:branch:main:rules',
    );
  });

  it('builds the single repository read token key', () => {
    expect.assertions(1);
    expect(CACHE_KEYS.GITHUB_SINGLE_REPOSITORY_READ_TOKEN(11, 7)).toBe(
      'github:installation:11:repository:7:read-token',
    );
  });

  it('builds wildcard invalidation patterns for issues, PRs, repos, and installations', () => {
    expect.assertions(4);
    expect(CACHE_KEYS.GITHUB_RESPONSE_ISSUE_PATTERN('octo', 'repo', 5)).toBe(
      'github:response:octo:repo:issue:5:*',
    );
    expect(CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN('octo', 'repo', 9)).toBe(
      'github:response:octo:repo:pr:9:*',
    );
    expect(CACHE_KEYS.GITHUB_RESPONSE_REPO_PATTERN('octo', 'repo')).toBe(
      'github:response:octo:repo:*',
    );
    expect(CACHE_KEYS.GITHUB_RESPONSE_INSTALLATION_PATTERN(11)).toBe(
      'github:response:installation:11:*',
    );
  });

  it('builds the worker aggregate PRs key', () => {
    expect.assertions(1);
    expect(CACHE_KEYS.GITHUB_WORKER_AGGREGATE_PRS(7, 's:open')).toBe(
      'github:worker:repository:7:prs:s:open',
    );
  });

  it('exposes the app webhook configuration key as a static string', () => {
    expect.assertions(1);
    expect(CACHE_KEYS.GITHUB_APP_WEBHOOK_CONFIGURATION).toBe('github:app:webhook-configuration');
  });
});
