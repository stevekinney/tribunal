import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { getDiffContext, parseCommentableLines } from './diff-context.js';

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

  it('uses the cached diff context when repository id is provided', async () => {
    const listFiles = vi.fn();
    const context = createContext(listFiles);
    vi.mocked(context.cache.getCached).mockResolvedValue({
      value: [createPullRequestFile(1)],
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      source: 'api',
    });

    const result = await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('stores fetched diff context in cache when repository id is provided', async () => {
    const listFiles = vi.fn().mockResolvedValue({ data: [createPullRequestFile(1)] });
    const context = createContext(listFiles);

    const result = await getDiffContext(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      repositoryId: 123,
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(context.cache.setCache).toHaveBeenCalled();
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
