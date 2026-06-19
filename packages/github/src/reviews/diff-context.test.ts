import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { getDiffContext, getPullRequestMetadata, parseCommentableLines } from './diff-context.js';

function createPullRequestFile(
  index: number,
  patch: string | null | undefined = '@@ -1 +1 @@\n-old\n+new',
) {
  return {
    filename: `src/file-${index}.ts`,
    previous_filename: index === 0 ? 'src/old-file.ts' : undefined,
    status: index === 0 ? 'renamed' : 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch,
  };
}

const pullRequestResponse = {
  head: { sha: 'head-sha' },
  base: { sha: 'base-sha' },
  title: 'Review engine foundation',
  body: null,
  labels: [{ name: 'review-engine' }, { name: '' }],
  user: { login: 'steve' },
};

function createContext(
  listFiles: ReturnType<typeof vi.fn>,
  octokit?: Octokit | null,
): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(
      octokit === undefined
        ? ({
            rest: {
              pulls: {
                listFiles,
              },
            },
          } as unknown as Octokit)
        : octokit,
    ),
  };
}

describe('getDiffContext', () => {
  it('lists all pull request files across pages when no repository id is provided', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => createPullRequestFile(index));
    const secondPage = [createPullRequestFile(100, null)];
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage })
      .mockResolvedValueOnce({ data: secondPage });
    const context = createContext(listFiles);

    const result = await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
    });

    expect(result.changedFiles).toHaveLength(101);
    expect(result.changedFiles[0]).toMatchObject({
      path: 'src/file-0.ts',
      previousPath: 'src/old-file.ts',
      status: 'renamed',
      commentableLines: [
        { line: 1, side: 'LEFT' },
        { line: 1, side: 'RIGHT' },
      ],
    });
    expect(result.changedFiles[100]).toMatchObject({
      patch: null,
      commentableLines: [],
    });
    expect(listFiles).toHaveBeenNthCalledWith(1, {
      owner: 'lostgradient',
      repo: 'tribunal',
      pull_number: 42,
      per_page: 100,
      page: 1,
    });
    expect(listFiles).toHaveBeenNthCalledWith(2, {
      owner: 'lostgradient',
      repo: 'tribunal',
      pull_number: 42,
      per_page: 100,
      page: 2,
    });
    expect(context.cache.setCache).not.toHaveBeenCalled();
  });

  it('bypasses the cache when repository id is provided without a reviewed head SHA', async () => {
    const listFiles = vi.fn();
    const context = createContext(listFiles);
    listFiles.mockResolvedValue({ data: [createPullRequestFile(1)] });

    const result = await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(context.cache.getCached).not.toHaveBeenCalled();
  });

  it('stores fetched diff context in cache when repository id and reviewed head SHA are provided', async () => {
    const listFiles = vi.fn().mockResolvedValue({ data: [createPullRequestFile(1)] });
    const context = createContext(listFiles);

    const result = await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
      headSha: 'aaa111',
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(context.cache.setCache).toHaveBeenCalled();
  });

  it('uses separate cached diff contexts for separate reviewed head SHAs', async () => {
    const listFiles = vi.fn().mockResolvedValue({ data: [createPullRequestFile(1)] });
    const context = createContext(listFiles);

    await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
      headSha: 'aaa111',
    });
    await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
      headSha: 'bbb222',
    });

    expect(context.cache.getCached).toHaveBeenNthCalledWith(
      1,
      'github:response:repository:123:pr:42:head:aaa111:diff-context',
    );
    expect(context.cache.getCached).toHaveBeenNthCalledWith(
      2,
      'github:response:repository:123:pr:42:head:bbb222:diff-context',
    );
    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it('reuses the cached diff context for the same reviewed head SHA', async () => {
    const listFiles = vi.fn().mockResolvedValue({ data: [createPullRequestFile(1)] });
    const context = createContext(listFiles);
    const cachedEnvelopes = new Map<string, unknown>();
    vi.mocked(context.cache.getCached).mockImplementation(async (key) => {
      return cachedEnvelopes.get(key) ?? null;
    });
    vi.mocked(context.cache.setCache).mockImplementation(async (key, envelope) => {
      cachedEnvelopes.set(key, envelope);
      return true;
    });

    await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
      headSha: 'aaa111',
    });
    await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
      headSha: 'aaa111',
    });

    expect(context.cache.getCached).toHaveBeenCalledTimes(2);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['owner', { owner: ' ' }],
    ['repository', { repository: '' }],
    ['pullRequestNumber', { pullRequestNumber: 0 }],
  ])('rejects invalid %s before calling GitHub', async (_label, override) => {
    const listFiles = vi.fn();
    const context = createContext(listFiles);

    await expect(
      getDiffContext(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        ...override,
      }),
    ).rejects.toThrow(ValidationError);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('rejects unavailable installations before listing files', async () => {
    const listFiles = vi.fn();
    const context = createContext(listFiles, null);

    await expect(
      getDiffContext(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
      }),
    ).rejects.toThrow(ValidationError);
    expect(listFiles).not.toHaveBeenCalled();
  });
});

describe('getPullRequestMetadata', () => {
  it('uses the cached pull request read policy', async () => {
    const getPullRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: { etag: '"pull-request-etag"' },
      data: pullRequestResponse,
    });
    const context = createContext(vi.fn(), {
      rest: { pulls: { get: getPullRequest } },
    } as unknown as Octokit);

    const result = await getPullRequestMetadata(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
    });

    expect(result).toEqual({
      headSha: 'head-sha',
      baseSha: 'base-sha',
      title: 'Review engine foundation',
      body: '',
      labels: ['review-engine'],
      author: 'steve',
    });
    expect(context.cache.setCache).toHaveBeenCalled();
    expect(getPullRequest).toHaveBeenCalledWith({
      owner: 'lostgradient',
      repo: 'tribunal',
      pull_number: 42,
      headers: undefined,
    });
  });

  it('returns cached pull request metadata without calling GitHub', async () => {
    const getPullRequest = vi.fn();
    const context = createContext(vi.fn(), {
      rest: { pulls: { get: getPullRequest } },
    } as unknown as Octokit);
    vi.mocked(context.cache.getCached).mockResolvedValue({
      value: pullRequestResponse,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      source: 'api',
    });

    await expect(
      getPullRequestMetadata(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
      }),
    ).resolves.toMatchObject({ headSha: 'head-sha' });
    expect(getPullRequest).not.toHaveBeenCalled();
  });

  it('reuses cached pull request metadata when GitHub returns not modified', async () => {
    const notModifiedError = Object.assign(new Error('Not Modified'), { status: 304 });
    const getPullRequest = vi.fn().mockRejectedValue(notModifiedError);
    const context = createContext(vi.fn(), {
      rest: { pulls: { get: getPullRequest } },
    } as unknown as Octokit);
    vi.mocked(context.cache.getCached).mockResolvedValue({
      value: pullRequestResponse,
      etag: '"pull-request-etag"',
      fetchedAt: Date.now() - 60_000,
      expiresAt: Date.now() - 1,
      source: 'api',
    });

    await expect(
      getPullRequestMetadata(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
      }),
    ).resolves.toMatchObject({ headSha: 'head-sha' });
    expect(getPullRequest).toHaveBeenCalledWith({
      owner: 'lostgradient',
      repo: 'tribunal',
      pull_number: 42,
      headers: { 'if-none-match': '"pull-request-etag"' },
    });
  });

  it('propagates conditional pull request metadata errors that are not not-modified', async () => {
    const unavailableError = Object.assign(new Error('Service unavailable'), { status: 503 });
    const getPullRequest = vi.fn().mockRejectedValue(unavailableError);
    const context = createContext(vi.fn(), {
      rest: { pulls: { get: getPullRequest } },
    } as unknown as Octokit);
    vi.mocked(context.cache.getCached).mockResolvedValue({
      value: pullRequestResponse,
      etag: '"pull-request-etag"',
      fetchedAt: Date.now() - 60_000,
      expiresAt: Date.now() - 1,
      source: 'api',
    });

    await expect(
      getPullRequestMetadata(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
      }),
    ).rejects.toThrow('Service unavailable');
  });
});

describe('parseCommentableLines', () => {
  it('extracts deterministic LEFT and RIGHT commentable lines from a patch', () => {
    const patch = [
      '@@ -10,4 +10,5 @@ export function example() {',
      ' const kept = true;',
      '-const removed = true;',
      '+const added = true;',
      '+const alsoAdded = true;',
      ' return kept;',
    ].join('\n');

    expect(parseCommentableLines(patch)).toEqual([
      { line: 11, side: 'LEFT' },
      { line: 11, side: 'RIGHT' },
      { line: 12, side: 'RIGHT' },
    ]);
  });

  it('ignores file header marker lines and sorts by side then line', () => {
    const patch = [
      '@@ -1,2 +3,2 @@',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '-old',
      '+new',
    ].join('\n');

    expect(parseCommentableLines(patch)).toEqual([
      { line: 1, side: 'LEFT' },
      { line: 3, side: 'RIGHT' },
    ]);
  });
});
