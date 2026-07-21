import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import type { GithubServiceContext } from '../../context.js';
import { upsertPRState } from './state.js';
import { handleBaseBranchPush } from './base-branch-update.js';

let testContext: TestContext;

beforeAll(async () => {
  testContext = await createTestContext();
});

afterAll(async () => {
  await testContext.close();
});

beforeEach(async () => {
  await testContext.reset();
});

function createGithubContext(): GithubServiceContext {
  return {
    db: testContext.db as unknown as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
  };
}

function createOctokit(responses: Array<{ mergeable_state?: string; base?: { sha: string } }>) {
  const get = vi.fn();
  for (const response of responses) {
    get.mockResolvedValueOnce({
      data: {
        mergeable_state: response.mergeable_state ?? 'clean',
        base: response.base ?? { sha: 'base-sha' },
      },
    });
  }
  return { rest: { pulls: { get } } } as never;
}

describe('handleBaseBranchPush', () => {
  it('does nothing when the pushed branch is not the default branch', async () => {
    const repository = await testContext.factories.repository.create({ id: 5001 });
    const context = createGithubContext();
    const octokit = createOctokit([]);

    const result = await handleBaseBranchPush(
      context,
      { repositoryId: repository.id, ref: 'refs/heads/feature', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );

    expect(result).toEqual({ updated: 0, errors: 0, affectedPrNumbers: [] });
  });

  it('does nothing when there are no open PRs targeting the pushed branch', async () => {
    const repository = await testContext.factories.repository.create({ id: 5002 });
    const context = createGithubContext();
    const octokit = createOctokit([]);

    const result = await handleBaseBranchPush(
      context,
      { repositoryId: repository.id, ref: 'refs/heads/main', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );

    expect(result).toEqual({ updated: 0, errors: 0, affectedPrNumbers: [] });
  });

  it('updates merge status for every open PR targeting the pushed default branch', async () => {
    const repository = await testContext.factories.repository.create({ id: 5003 });
    const context = createGithubContext();
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      isMerged: false,
      baseRef: 'main',
    });
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 2,
      state: 'open',
      isMerged: false,
      baseRef: 'main',
    });
    const octokit = createOctokit([
      { mergeable_state: 'clean', base: { sha: 'new-base-sha' } },
      { mergeable_state: 'dirty', base: { sha: 'new-base-sha' } },
    ]);

    const result = await handleBaseBranchPush(
      context,
      { repositoryId: repository.id, ref: 'refs/heads/main', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );

    expect(result.updated).toBe(2);
    expect(result.errors).toBe(0);
    expect(result.affectedPrNumbers.sort()).toEqual([1, 2]);
  });

  it('does not update PRs targeting a different branch, a closed PR, or a merged PR', async () => {
    const repository = await testContext.factories.repository.create({ id: 5004 });
    const context = createGithubContext();
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      isMerged: false,
      baseRef: 'develop',
    });
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 2,
      state: 'closed',
      isMerged: false,
      baseRef: 'main',
    });
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 3,
      state: 'closed',
      isMerged: true,
      baseRef: 'main',
    });
    const octokit = createOctokit([]);

    const result = await handleBaseBranchPush(
      context,
      { repositoryId: repository.id, ref: 'refs/heads/main', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );

    expect(result).toEqual({ updated: 0, errors: 0, affectedPrNumbers: [] });
  });

  it('counts a failed per-PR fetch as an error without aborting the remaining PRs', async () => {
    const repository = await testContext.factories.repository.create({ id: 5005 });
    const context = createGithubContext();
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      isMerged: false,
      baseRef: 'main',
    });
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 2,
      state: 'open',
      isMerged: false,
      baseRef: 'main',
    });
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ data: { mergeable_state: 'clean', base: { sha: 'sha' } } });
    const octokit = { rest: { pulls: { get } } } as never;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await handleBaseBranchPush(
      context,
      { repositoryId: repository.id, ref: 'refs/heads/main', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );

    expect(result.updated).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.affectedPrNumbers.sort()).toEqual([1, 2]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update PR #'),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });
});
