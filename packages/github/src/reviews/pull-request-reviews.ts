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
    }),
  );

  return {
    id: response.data.id,
    htmlUrl: response.data.html_url ?? null,
  };
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
