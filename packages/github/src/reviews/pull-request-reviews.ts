import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { withGitHubWriteErrorClassification } from './errors.js';

type ReviewCommentSide = 'LEFT' | 'RIGHT';

export interface PullRequestReviewCommentInput {
  path: string;
  body: string;
  line: number;
  side: ReviewCommentSide;
  startLine?: number;
  startSide?: ReviewCommentSide;
}

export interface PostPullRequestReviewInput {
  installationId: number;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  body?: string;
  comments: PullRequestReviewCommentInput[];
}

interface GitHubReviewCommentPayload {
  path: string;
  body: string;
  line: number;
  side: ReviewCommentSide;
  start_line?: number;
  start_side?: ReviewCommentSide;
}

interface PullRequestReviewListItem {
  id: number;
  body: string | null;
}

const reviewWriteTimeoutMilliseconds = 60_000;
const reviewMarkerLookupTimeoutMilliseconds = 60_000;

export interface FindPostedPullRequestReviewInput {
  installationId: number;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  reviewMarker: string;
}

export async function postPullRequestReview(
  context: GithubServiceContext,
  input: PostPullRequestReviewInput,
): Promise<{ id: number; htmlUrl: string | null }> {
  validatePostPullRequestReviewInput(input);
  const octokit = await requireInstallationOctokit(context, input.installationId);
  const comments = input.comments.map(toGitHubReviewCommentPayload);

  const response = await withGitHubWriteErrorClassification(() =>
    octokit.rest.pulls.createReview({
      owner: input.owner,
      repo: input.repository,
      pull_number: input.pullRequestNumber,
      commit_id: input.headSha,
      event: 'COMMENT',
      body: input.body,
      comments,
      request: {
        signal: AbortSignal.timeout(reviewWriteTimeoutMilliseconds),
      },
    }),
  );

  return {
    id: response.data.id,
    htmlUrl: response.data.html_url ?? null,
  };
}

export async function findPostedPullRequestReview(
  context: GithubServiceContext,
  input: FindPostedPullRequestReviewInput,
): Promise<{ id: number; comments: number } | undefined> {
  validateFindPostedPullRequestReviewInput(input);
  const octokit = await requireInstallationOctokit(context, input.installationId);
  const signal = AbortSignal.timeout(reviewMarkerLookupTimeoutMilliseconds);
  const review = await findReviewByMarker(
    octokit,
    input.owner,
    input.repository,
    input.pullRequestNumber,
    input.reviewMarker,
    signal,
  );
  if (review === undefined) return undefined;

  const comments = await listPullRequestReviewComments(
    octokit,
    input.owner,
    input.repository,
    input.pullRequestNumber,
    review.id,
    signal,
  );
  return { id: review.id, comments };
}

export function validatePostPullRequestReviewInput(input: PostPullRequestReviewInput): void {
  validateRepositoryTarget(input.owner, input.repository);
  validatePositiveInteger(input.pullRequestNumber, 'pullRequestNumber');
  validateNonEmptyString(input.headSha, 'headSha');
  if (input.body !== undefined) validateNonEmptyString(input.body, 'body');

  if (input.comments.length === 0) {
    throw new ValidationError('A pull request review must include at least one inline comment.');
  }

  for (const comment of input.comments) {
    validateReviewComment(comment);
  }
}

function validateFindPostedPullRequestReviewInput(input: FindPostedPullRequestReviewInput): void {
  validateRepositoryTarget(input.owner, input.repository);
  validatePositiveInteger(input.pullRequestNumber, 'pullRequestNumber');
  validateNonEmptyString(input.reviewMarker, 'reviewMarker');
}

function validateReviewComment(comment: PullRequestReviewCommentInput): void {
  validateNonEmptyString(comment.path, 'comment.path');
  validateNonEmptyString(comment.body, 'comment.body');
  validatePositiveInteger(comment.line, 'comment.line');
  validateSide(comment.side, 'comment.side');

  if (comment.startLine !== undefined || comment.startSide !== undefined) {
    validatePositiveInteger(comment.startLine, 'comment.startLine');
    validateSide(comment.startSide, 'comment.startSide');
    if (comment.startLine! > comment.line) {
      throw new ValidationError('comment.startLine must be less than or equal to comment.line.');
    }
  }
}

async function findReviewByMarker(
  octokit: Octokit,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  marker: string,
  signal: AbortSignal,
): Promise<PullRequestReviewListItem | undefined> {
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const response = await withGitHubWriteErrorClassification(() =>
      octokit.rest.pulls.listReviews({
        owner,
        repo: repository,
        pull_number: pullRequestNumber,
        per_page: perPage,
        page,
        request: { signal },
      }),
    );
    const review = response.data.find((candidate) => candidate.body?.includes(marker));
    if (review !== undefined) return review;
    if (response.data.length < perPage) return undefined;
  }
}

async function listPullRequestReviewComments(
  octokit: Octokit,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  reviewId: number,
  signal: AbortSignal,
): Promise<number> {
  let comments = 0;
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const response = await withGitHubWriteErrorClassification(() =>
      octokit.rest.pulls.listCommentsForReview({
        owner,
        repo: repository,
        pull_number: pullRequestNumber,
        review_id: reviewId,
        per_page: perPage,
        page,
        request: { signal },
      }),
    );
    comments += response.data.length;
    if (response.data.length < perPage) return comments;
  }
}

function toGitHubReviewCommentPayload(
  comment: PullRequestReviewCommentInput,
): GitHubReviewCommentPayload {
  return {
    path: comment.path,
    body: comment.body.trim(),
    line: comment.line,
    side: comment.side,
    ...(comment.startLine !== undefined ? { start_line: comment.startLine } : {}),
    ...(comment.startSide !== undefined ? { start_side: comment.startSide } : {}),
  };
}

async function requireInstallationOctokit(
  context: GithubServiceContext,
  installationId: number,
): Promise<Octokit> {
  const octokit = await context.getInstallationOctokit(installationId);
  if (!octokit) {
    throw new ValidationError(`GitHub installation ${installationId} is not available.`);
  }
  return octokit;
}

function validateRepositoryTarget(owner: string, repository: string): void {
  validateNonEmptyString(owner, 'owner');
  validateNonEmptyString(repository, 'repository');
}

function validateNonEmptyString(value: string | undefined, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
}

function validatePositiveInteger(value: number | undefined, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be a positive integer.`);
  }
}

function validateSide(
  value: string | undefined,
  label: string,
): asserts value is ReviewCommentSide {
  if (value !== 'LEFT' && value !== 'RIGHT') {
    throw new ValidationError(`${label} must be LEFT or RIGHT.`);
  }
}
