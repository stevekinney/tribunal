import type { Endpoints } from '@octokit/types';
import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy } from '../core/cache-policy.js';
import { isNotModifiedError } from '../errors.js';
import { ValidationError } from '../error-taxonomy.js';
import { validateNonEmptyString, withGitHubWriteErrorClassification } from './errors.js';

type PullRequestFile =
  Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}/files']['response']['data'][number];
type PullRequest = Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}']['response']['data'];
type DiffSide = 'LEFT' | 'RIGHT';

export interface CommentableLine {
  line: number;
  side: DiffSide;
}

export interface ChangedFileDiffContext {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  commentableLines: CommentableLine[];
}

export interface DiffContext {
  owner: string;
  repository: string;
  pullRequestNumber: number;
  changedFiles: ChangedFileDiffContext[];
}

export interface PullRequestMetadata {
  headSha: string;
  baseSha: string;
  title: string;
  body: string;
  labels: string[];
  author: string;
}

export async function getPullRequestMetadata(
  context: GithubServiceContext,
  input: {
    installationId: number;
    owner: string;
    repository: string;
    pullRequestNumber: number;
  },
): Promise<PullRequestMetadata> {
  validateDiffContextInput(input);
  const octokit = await requireInstallationOctokit(context, input.installationId);
  const policy = requirePolicy('get-pull-request');
  const { value } = await cachedRead<PullRequest>(
    context.cache,
    policy,
    async (etag) => {
      try {
        const response = await withGitHubWriteErrorClassification(() =>
          octokit.rest.pulls.get({
            owner: input.owner,
            repo: input.repository,
            pull_number: input.pullRequestNumber,
            headers: etag === undefined ? undefined : { 'if-none-match': etag },
          }),
        );
        return { data: response.data as PullRequest, etag: response.headers.etag };
      } catch (error) {
        if (etag !== undefined && isNotModifiedError(error)) {
          return { notModified: true };
        }
        throw error;
      }
    },
    [input.owner, input.repository, input.pullRequestNumber],
  );

  return toPullRequestMetadata(value);
}

export async function getDiffContext(
  context: GithubServiceContext,
  input: {
    installationId: number;
    owner: string;
    repository: string;
    pullRequestNumber: number;
    repositoryId?: number;
    headSha?: string;
  },
): Promise<DiffContext> {
  validateDiffContextInput(input);
  if (input.headSha !== undefined) validateNonEmptyString(input.headSha, 'headSha');
  const octokit = await requireInstallationOctokit(context, input.installationId);
  const fetchFiles = () =>
    withGitHubWriteErrorClassification(() =>
      listPullRequestFiles(octokit, input.owner, input.repository, input.pullRequestNumber),
    );

  if (input.repositoryId === undefined || input.headSha === undefined) {
    return toDiffContext(input, await fetchFiles());
  }

  const policy = requirePolicy('get-pull-request-diff-context');
  const { value } = await cachedRead(
    context.cache,
    policy,
    async () => {
      const files = await fetchFiles();
      return { data: files };
    },
    [input.repositoryId, input.pullRequestNumber, input.headSha],
  );

  return toDiffContext(input, value);
}

async function listPullRequestFiles(
  octokit: Octokit,
  owner: string,
  repository: string,
  pullRequestNumber: number,
): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo: repository,
      pull_number: pullRequestNumber,
      per_page: perPage,
      page,
    });

    files.push(...response.data);
    if (response.data.length < perPage) break;
  }

  return files;
}

function toDiffContext(
  input: { owner: string; repository: string; pullRequestNumber: number },
  files: PullRequestFile[],
): DiffContext {
  return {
    owner: input.owner,
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    changedFiles: files.map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename ?? null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null,
      commentableLines: parseCommentableLines(file.patch ?? ''),
    })),
  };
}

function toPullRequestMetadata(pullRequest: PullRequest): PullRequestMetadata {
  return {
    headSha: pullRequest.head.sha,
    baseSha: pullRequest.base.sha,
    title: pullRequest.title,
    body: pullRequest.body ?? '',
    labels: pullRequest.labels.map((label) => normalizeLabelName(label)).filter(isNonEmptyString),
    author: pullRequest.user?.login ?? '',
  };
}

export function parseCommentableLines(patch: string): CommentableLine[] {
  const lines: CommentableLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const patchLine of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(patchLine);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }

    if (patchLine.startsWith('+') && !patchLine.startsWith('+++')) {
      lines.push({ line: newLine, side: 'RIGHT' });
      newLine += 1;
      continue;
    }

    if (patchLine.startsWith('-') && !patchLine.startsWith('---')) {
      lines.push({ line: oldLine, side: 'LEFT' });
      oldLine += 1;
      continue;
    }

    if (patchLine.startsWith(' ') || patchLine.length === 0) {
      oldLine += 1;
      newLine += 1;
    }
  }

  return lines.sort((a, b) => (a.side === b.side ? a.line - b.line : a.side < b.side ? -1 : 1));
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

function validateDiffContextInput(input: {
  owner: string;
  repository: string;
  pullRequestNumber: number;
}): void {
  validateNonEmptyString(input.owner, 'owner');
  validateNonEmptyString(input.repository, 'repository');
  if (!Number.isInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0) {
    throw new ValidationError('pullRequestNumber must be a positive integer.');
  }
}

function normalizeLabelName(label: { name?: string | null } | string): string {
  return typeof label === 'string' ? label : (label.name ?? '');
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
