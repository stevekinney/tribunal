import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { findPostedPullRequestReview, postPullRequestReview } from './pull-request-reviews.js';

function createContext(
  createReview: ReturnType<typeof vi.fn>,
  overrides: Partial<Octokit['rest']['pulls']> = {},
): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn().mockResolvedValue({
      rest: {
        pulls: {
          createReview,
          ...overrides,
        },
      },
    } as unknown as Octokit),
  };
}

const validComment = {
  path: 'src/example.ts',
  body: 'Please check this.',
  line: 12,
  side: 'RIGHT' as const,
};

describe('postPullRequestReview', () => {
  it('posts one batched COMMENT review with modern line anchors and no position field', async () => {
    const createReview = vi.fn().mockResolvedValue({
      data: {
        id: 123,
        html_url: 'https://github.example/review/123',
      },
    });
    const context = createContext(createReview);

    await postPullRequestReview(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      pullRequestNumber: 42,
      headSha: 'abc123',
      body: 'Tribunal review',
      comments: [
        {
          path: 'src/example.ts',
          body: 'Please check this.',
          line: 12,
          side: 'RIGHT',
        },
        {
          path: 'src/example.ts',
          body: 'This range is risky.',
          startLine: 20,
          startSide: 'RIGHT',
          line: 22,
          side: 'RIGHT',
        },
      ],
    });

    expect(createReview).toHaveBeenCalledTimes(1);
    const payload = createReview.mock.calls[0][0];
    expect(payload).toMatchObject({
      owner: 'lostgradient',
      repo: 'tribunal',
      pull_number: 42,
      commit_id: 'abc123',
      event: 'COMMENT',
    });
    expect(payload.request.signal).toBeInstanceOf(AbortSignal);
    expect(payload.comments).toEqual([
      {
        path: 'src/example.ts',
        body: 'Please check this.',
        line: 12,
        side: 'RIGHT',
      },
      {
        path: 'src/example.ts',
        body: 'This range is risky.',
        start_line: 20,
        start_side: 'RIGHT',
        line: 22,
        side: 'RIGHT',
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain('position');
  });

  it('rejects whitespace-only review comment bodies before calling GitHub', async () => {
    const createReview = vi.fn();
    const context = createContext(createReview);

    await expect(
      postPullRequestReview(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        headSha: 'abc123',
        comments: [
          {
            path: 'src/example.ts',
            body: '   ',
            line: 12,
            side: 'RIGHT',
          },
        ],
      }),
    ).rejects.toThrow(ValidationError);
    expect(createReview).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { owner: ' ' }],
    ['repository', { repository: '' }],
    ['pullRequestNumber', { pullRequestNumber: 0 }],
    ['headSha', { headSha: ' ' }],
    ['body', { body: '' }],
    ['comments', { comments: [] }],
    ['comment.path', { comments: [{ ...validComment, path: ' ' }] }],
    ['comment.line', { comments: [{ ...validComment, line: -1 }] }],
    ['comment.side', { comments: [{ ...validComment, side: 'BASE' }] }],
    ['comment.startLine', { comments: [{ ...validComment, startLine: 0, startSide: 'RIGHT' }] }],
    ['comment.startSide', { comments: [{ ...validComment, startLine: 10 }] }],
  ])('rejects invalid %s before calling GitHub', async (_label, override) => {
    const createReview = vi.fn();
    const context = createContext(createReview);

    await expect(
      postPullRequestReview(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        headSha: 'abc123',
        comments: [validComment],
        ...override,
      }),
    ).rejects.toThrow(ValidationError);
    expect(createReview).not.toHaveBeenCalled();
  });

  it('rejects review ranges that start after the target line', async () => {
    const createReview = vi.fn();
    const context = createContext(createReview);

    await expect(
      postPullRequestReview(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        headSha: 'abc123',
        comments: [{ ...validComment, startLine: 13, startSide: 'RIGHT' }],
      }),
    ).rejects.toThrow('comment.startLine must be less than or equal to comment.line.');
    expect(createReview).not.toHaveBeenCalled();
  });

  it('rejects unavailable installations before calling GitHub', async () => {
    const createReview = vi.fn();
    const context = {
      db: {} as GithubServiceContext['db'],
      cache: {} as GithubServiceContext['cache'],
      getInstallationOctokit: vi.fn().mockResolvedValue(null),
    };

    await expect(
      postPullRequestReview(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        headSha: 'abc123',
        comments: [validComment],
      }),
    ).rejects.toThrow(ValidationError);
    expect(createReview).not.toHaveBeenCalled();
  });
});

describe('findPostedPullRequestReview', () => {
  it('finds a Tribunal review marker and counts the review comments', async () => {
    const reviewMarker = '<!-- tribunal-review-run:v1:run:42:7:aaa111:opened:signed-marker -->';
    const listReviews = vi.fn().mockResolvedValue({
      data: [
        { id: 10, body: 'Other review' },
        {
          id: 11,
          body: `Tribunal review\n\n${reviewMarker}`,
        },
      ],
    });
    const listCommentsForReview = vi.fn().mockResolvedValue({
      data: [{ id: 1 }, { id: 2 }],
    });
    const context = createContext(vi.fn(), { listReviews, listCommentsForReview });

    await expect(
      findPostedPullRequestReview(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        reviewMarker,
      }),
    ).resolves.toEqual({ id: 11, comments: 2 });

    expect(listCommentsForReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 11 }));
    const listReviewsSignal = listReviews.mock.calls[0][0].request.signal;
    expect(listReviewsSignal).toBeInstanceOf(AbortSignal);
    expect(listCommentsForReview).toHaveBeenCalledWith(
      expect.objectContaining({ request: { signal: listReviewsSignal } }),
    );
  });

  it('returns undefined when no review contains the run marker', async () => {
    const reviewMarker = '<!-- tribunal-review-run:v1:run:42:7:aaa111:opened:signed-marker -->';
    const listReviews = vi.fn().mockResolvedValue({
      data: [
        { id: 10, body: 'Other review' },
        { id: 11, body: '<!-- tribunal-review-run:run:42:7:aaa111:opened -->' },
      ],
    });
    const listCommentsForReview = vi.fn();
    const context = createContext(vi.fn(), { listReviews, listCommentsForReview });

    await expect(
      findPostedPullRequestReview(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 42,
        reviewMarker,
      }),
    ).resolves.toBeUndefined();

    expect(listCommentsForReview).not.toHaveBeenCalled();
  });
});
