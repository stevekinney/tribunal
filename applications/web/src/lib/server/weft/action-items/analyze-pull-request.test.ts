/**
 * Regression test for analyzePullRequest's activity calling convention, plus
 * behavioral coverage of the full analysis pipeline (GraphQL fetch, derivation,
 * reconciliation, generation fence, DB persistence, and PR body write-back).
 *
 * Weft invokes an activity as execute(input, ActivityContext) — the AbortSignal
 * is ActivityContext.signal, NOT the second positional argument itself. An
 * earlier version typed the second param as `signal?: AbortSignal`, so at runtime
 * the engine's ActivityContext was bound to `signal` and `signal.throwIfAborted`
 * was undefined — the cooperative cancellation checks silently never fired (or
 * threw a TypeError). This test pins that the activity reads the signal from the
 * context and honors a pre-aborted signal before doing any I/O.
 *
 * The GitHub boundary (octokit) is faked; the database is a real ephemeral test
 * database (per project convention — do not mock the DB), and the pure
 * action-items reconciliation helpers run for real.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { pullRequestActionItem, pullRequestState, repository } from '@tribunal/database/schema';

const { getInstallationOctokit, dbHolder } = vi.hoisted(() => ({
  getInstallationOctokit: vi.fn(),
  dbHolder: { db: undefined as unknown },
}));

// The activity destructures githubContext at the top, so the mock must provide
// db + getInstallationOctokit. getInstallationOctokit must NOT be called when the
// signal is already aborted (the abort check fires first).
vi.mock('$lib/server/github-context', () => ({
  githubContext: {
    get db() {
      return dbHolder.db;
    },
    getInstallationOctokit,
  },
}));

import { analyzePullRequest } from './analyze-pull-request.js';

const input = {
  workspaceId: 1,
  repositoryId: 10,
  prNumber: 5,
  installationId: 100,
  owner: 'acme',
  repository: 'widgets',
  analysisGeneration: 1,
};

describe('analyzePullRequest cooperative cancellation', () => {
  afterEach(() => {
    getInstallationOctokit.mockReset();
  });

  it('reads the AbortSignal from ActivityContext.signal and honors a pre-aborted run', async () => {
    const controller = new AbortController();
    controller.abort();

    // Pass the signal the way Weft does: as ActivityContext.signal.
    await expect(analyzePullRequest(input, { signal: controller.signal })).rejects.toThrow();

    // The abort check fired before any GitHub I/O.
    expect(getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('does not abort when the context signal is not aborted (reaches the octokit lookup)', async () => {
    // Not aborted: the activity proceeds past the first throwIfAborted to the
    // octokit lookup. We stub getInstallationOctokit to return null so the
    // activity returns early (Installation not configured) without real I/O —
    // proving the signal was read from the context and did NOT spuriously abort.
    getInstallationOctokit.mockResolvedValue(null);
    const controller = new AbortController();

    const result = await analyzePullRequest(input, { signal: controller.signal });

    expect(getInstallationOctokit).toHaveBeenCalledWith(100);
    expect(result).toEqual({
      updated: false,
      actionItemCount: 0,
      persisted: false,
      error: 'Installation not configured',
    });
  });
});

describe('analyzePullRequest full pipeline (real database, faked octokit)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    dbHolder.db = testDb.db;
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  afterEach(async () => {
    await testDb.reset();
    getInstallationOctokit.mockReset();
    vi.restoreAllMocks();
  });

  async function seedRepositoryAndState(overrides: { headSha?: string; body?: string } = {}) {
    await testDb.db.insert(repository).values({
      id: input.repositoryId,
      owner: input.owner,
      name: input.repository,
      uri: `https://github.com/${input.owner}/${input.repository}.git`,
      defaultBranch: 'main',
    });

    const [state] = await testDb.db
      .insert(pullRequestState)
      .values({
        repositoryId: input.repositoryId,
        prNumber: input.prNumber,
        headSha: overrides.headSha ?? 'sha-current',
      })
      .returning();

    return state;
  }

  function conversationResponse(overrides: Record<string, unknown> = {}) {
    return {
      repository: {
        pullRequest: {
          title: 'Add feature',
          body: overrides.body ?? 'Original PR body.',
          isDraft: false,
          state: 'OPEN',
          headRefOid: overrides.headRefOid ?? 'sha-current',
          reviews: { nodes: overrides.reviews ?? [] },
          reviewThreads: { nodes: overrides.reviewThreads ?? [] },
          comments: { nodes: overrides.comments ?? [] },
          commits: { nodes: overrides.commits ?? [] },
        },
      },
    };
  }

  function fakeOctokit(overrides: {
    graphqlResult?: unknown;
    graphqlError?: Error;
    getResult?: { head?: { sha: string }; body?: string | null };
    getError?: Error;
    updateError?: Error;
  }) {
    const update = overrides.updateError
      ? vi.fn().mockRejectedValue(overrides.updateError)
      : vi.fn().mockResolvedValue({});

    return {
      graphql: overrides.graphqlError
        ? vi.fn().mockRejectedValue(overrides.graphqlError)
        : vi.fn().mockResolvedValue(overrides.graphqlResult ?? conversationResponse()),
      rest: {
        pulls: {
          get: overrides.getError
            ? vi.fn().mockRejectedValue(overrides.getError)
            : vi.fn().mockResolvedValue({
                data: overrides.getResult ?? {
                  head: { sha: 'sha-current' },
                  body: 'Original PR body.',
                },
              }),
          update,
        },
      },
    };
  }

  it('returns early without DB or PR writes when no pullRequestState row exists', async () => {
    await testDb.db.insert(repository).values({
      id: input.repositoryId,
      owner: input.owner,
      name: input.repository,
      uri: `https://github.com/${input.owner}/${input.repository}.git`,
      defaultBranch: 'main',
    });

    const octokit = fakeOctokit({});
    getInstallationOctokit.mockResolvedValue(octokit);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await analyzePullRequest(input);

    expect(result).toEqual({ updated: false, actionItemCount: 0, persisted: false });
    expect(octokit.rest.pulls.update).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No pullRequestState row found'));
  });

  it('derives, reconciles, persists, and writes back the PR body on a clean run', async () => {
    await seedRepositoryAndState();

    const octokit = fakeOctokit({
      graphqlResult: conversationResponse({
        reviewThreads: [
          {
            id: 'thread-1',
            isResolved: false,
            comments: {
              nodes: [
                {
                  id: 'c1',
                  author: { login: 'reviewer' },
                  body: 'Please add a null check',
                  url: 'https://github.com/x/1',
                },
              ],
            },
          },
        ],
        comments: [
          {
            id: 'ic1',
            author: { login: 'bot' },
            body: 'CI is green now',
            url: 'https://github.com/x/2',
          },
        ],
        commits: [
          {
            commit: {
              statusCheckRollup: {
                state: 'FAILURE',
                contexts: {
                  nodes: [
                    {
                      __typename: 'CheckRun',
                      name: 'lint',
                      conclusion: 'FAILURE',
                      status: 'completed',
                      detailsUrl: 'https://ci/1',
                    },
                  ],
                },
              },
            },
          },
        ],
      }),
    });
    getInstallationOctokit.mockResolvedValue(octokit);

    const result = await analyzePullRequest(input);

    expect(result.persisted).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.actionItemCount).toBeGreaterThan(0);
    expect(octokit.rest.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: input.owner,
        repo: input.repository,
        pull_number: input.prNumber,
      }),
    );

    const items = await testDb.db.select().from(pullRequestActionItem);
    expect(items.length).toBe(result.actionItemCount);
    // The review-comment item carries a sourceUrl, exercising addActionItemSources.
    expect(items.some((item) => item.stableKey.startsWith('review-comment:'))).toBe(true);
    expect(items.some((item) => item.stableKey.startsWith('ci-check-'))).toBe(true);
  });

  it('skips the write when the generation fence trips (live head SHA has advanced)', async () => {
    await seedRepositoryAndState({ headSha: 'sha-current' });

    const octokit = fakeOctokit({
      graphqlResult: conversationResponse({ headRefOid: 'sha-current' }),
      getResult: { head: { sha: 'sha-newer' }, body: 'Original PR body.' },
    });
    getInstallationOctokit.mockResolvedValue(octokit);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await analyzePullRequest(input);

    expect(result).toEqual({
      updated: false,
      actionItemCount: 0,
      persisted: false,
      generationFenced: true,
    });
    expect(octokit.rest.pulls.update).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Generation fence tripped'));

    const items = await testDb.db.select().from(pullRequestActionItem);
    expect(items).toHaveLength(0);
  });

  it('proceeds without a fence and logs a warning when the live re-fetch fails', async () => {
    await seedRepositoryAndState();

    const octokit = fakeOctokit({
      graphqlResult: conversationResponse(),
      getError: new Error('network blip'),
    });
    getInstallationOctokit.mockResolvedValue(octokit);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await analyzePullRequest(input);

    expect(result.persisted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Live PR re-fetch failed'),
      expect.any(Error),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Proceeding WITHOUT a SHA generation fence'),
    );
  });

  it('returns updated:false without a GitHub write when the body is unchanged', async () => {
    // No reviews/threads/comments/checks: derivation yields no items, so
    // `updatePRDescription` renders the same "no action items yet" block that
    // is already present in the body — the write is a no-op.
    const emptyBlockBody = [
      'No comments here.',
      '',
      '<!--TRIBUNAL-ACTION-ITEMS-START-->',
      '## Action Items',
      '',
      '_No action items yet._',
      '',
      '<!--TRIBUNAL-ACTION-ITEMS-END-->',
    ].join('\n');
    await seedRepositoryAndState({ body: emptyBlockBody });

    const octokit = fakeOctokit({
      graphqlResult: conversationResponse({ body: emptyBlockBody }),
      getResult: { head: { sha: 'sha-current' }, body: emptyBlockBody },
    });
    getInstallationOctokit.mockResolvedValue(octokit);

    const result = await analyzePullRequest(input);

    expect(result).toEqual({ updated: false, actionItemCount: 0, persisted: true });
    expect(octokit.rest.pulls.update).not.toHaveBeenCalled();
  });

  it('reports a partial success when the GitHub PR update fails after DB persistence', async () => {
    await seedRepositoryAndState();

    const octokit = fakeOctokit({
      graphqlResult: conversationResponse({
        reviewThreads: [
          {
            id: 'thread-1',
            isResolved: false,
            comments: {
              nodes: [
                {
                  id: 'c1',
                  author: { login: 'r' },
                  body: 'Fix this parser bug',
                  url: 'https://x/1',
                },
              ],
            },
          },
        ],
      }),
      updateError: new Error('GitHub API 500'),
    });
    getInstallationOctokit.mockResolvedValue(octokit);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await analyzePullRequest(input);

    expect(result).toEqual({
      updated: false,
      actionItemCount: 1,
      persisted: true,
      error: 'github_update_failed',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('GitHub PR update failed'),
      expect.any(Error),
    );

    const items = await testDb.db.select().from(pullRequestActionItem);
    expect(items).toHaveLength(1);
  });

  it('derives items from changes-requested reviews and non-empty issue comments, skips a blank one, filters an unrecognized sanitized comment, and reuses firstSeenHeadSha on a second pass', async () => {
    await seedRepositoryAndState();

    const conversation = conversationResponse({
      reviewThreads: [
        {
          id: 'thread-resolved',
          isResolved: true,
          comments: {
            nodes: [
              {
                id: 'c1',
                author: { login: 'r' },
                body: 'This needs a longer explanation',
                url: 'https://x/1',
              },
              // Too short (<10 chars after normalization): filtered by
              // sanitizeActionItemCandidate before summarization, exercising
              // the `continue` branch for a rejected raw item.
              { id: 'c2', author: { login: 'r' }, body: 'ok', url: 'https://x/2' },
            ],
          },
        },
      ],
      reviews: [
        {
          id: 'review-1',
          author: null,
          state: 'CHANGES_REQUESTED',
          body: 'Please address the security concern here',
          url: 'https://x/review-1',
        },
      ],
      comments: [
        { id: 'ic-blank', author: { login: 'bot' }, body: '   ', url: 'https://x/blank' },
        {
          id: 'ic-real',
          author: { login: 'human' },
          body: 'This also needs more detail added',
          url: 'https://x/real',
        },
      ],
      commits: [
        {
          commit: {
            statusCheckRollup: {
              state: 'SUCCESS',
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'build',
                    conclusion: 'SUCCESS',
                    status: 'completed',
                    detailsUrl: 'https://ci/build',
                  },
                ],
              },
            },
          },
        },
      ],
    });

    const octokit = fakeOctokit({ graphqlResult: conversation });
    getInstallationOctokit.mockResolvedValue(octokit);

    const first = await analyzePullRequest(input);
    expect(first.persisted).toBe(true);
    expect(first.actionItemCount).toBe(3);

    const firstItems = await testDb.db.select().from(pullRequestActionItem);
    expect(firstItems.some((item) => item.stableKey === 'review-review-1')).toBe(true);
    expect(firstItems.some((item) => item.stableKey.startsWith('issue-comment-ic-real'))).toBe(
      true,
    );
    expect(firstItems.some((item) => item.stableKey.startsWith('issue-comment-ic-blank'))).toBe(
      false,
    );
    // The resolved thread's item auto-completes.
    const resolvedItem = firstItems.find((item) => item.stableKey.startsWith('review-comment:'));
    expect(resolvedItem?.status).not.toBe('pending');

    // Second pass: existingActionItems select is now non-empty, exercising the
    // firstSeenHeadSha carry-forward lookup.
    const second = await analyzePullRequest(input);
    expect(second.persisted).toBe(true);
    const secondItems = await testDb.db.select().from(pullRequestActionItem);
    expect(secondItems).toHaveLength(3);
  });

  it('preserves an existing human-checked item across reconciliation (never-delete contract)', async () => {
    const existingBody = [
      '<!--TRIBUNAL-ACTION-ITEMS-START-->',
      '## Action Items',
      '',
      '- [x] ~~Address review feedback~~ <!-- tribunal:ai:review-comment:thread-1:c1 -->',
      '',
      '<!--TRIBUNAL-ACTION-ITEMS-END-->',
    ].join('\n');

    await seedRepositoryAndState({ body: existingBody });

    const octokit = fakeOctokit({
      graphqlResult: conversationResponse({
        body: existingBody,
        reviewThreads: [
          {
            id: 'thread-1',
            isResolved: false,
            comments: {
              nodes: [
                {
                  id: 'c1',
                  author: { login: 'r' },
                  body: 'Address review feedback',
                  url: 'https://x/1',
                },
              ],
            },
          },
        ],
      }),
      getResult: { head: { sha: 'sha-current' }, body: existingBody },
    });
    getInstallationOctokit.mockResolvedValue(octokit);

    const result = await analyzePullRequest(input);

    expect(result.persisted).toBe(true);
    const [item] = await testDb.db.select().from(pullRequestActionItem);
    expect(item.status).not.toBe('pending');
  });
});
