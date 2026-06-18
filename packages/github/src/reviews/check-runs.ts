import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { validateNonEmptyString, withGitHubWriteErrorClassification } from './errors.js';

const MAX_CHECK_RUN_ANNOTATIONS_PER_REQUEST = 50;

type CheckRunStatus = 'queued' | 'in_progress' | 'completed';
type CheckRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required';
type AnnotationLevel = 'notice' | 'warning' | 'failure';

export interface CheckRunAnnotationInput {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: AnnotationLevel;
  message: string;
  title?: string;
  rawDetails?: string;
}

export interface CheckRunOutputInput {
  title: string;
  summary: string;
  text?: string;
  annotations?: CheckRunAnnotationInput[];
}

export interface CreateCheckRunInput {
  installationId: number;
  owner: string;
  repository: string;
  name: string;
  headSha: string;
  detailsUrl?: string;
  output?: CheckRunOutputInput;
}

export interface UpdateCheckRunInput {
  installationId: number;
  owner: string;
  repository: string;
  checkRunId: number;
  status?: CheckRunStatus;
  conclusion?: CheckRunConclusion;
  completedAt?: string;
  output?: CheckRunOutputInput;
}

export async function createCheckRun(
  context: GithubServiceContext,
  input: CreateCheckRunInput,
): Promise<{ id: number; htmlUrl: string | null }> {
  validateCreateCheckRunInput(input);
  const octokit = await requireInstallationOctokit(context, input.installationId);

  const response = await withGitHubWriteErrorClassification(() =>
    octokit.rest.checks.create({
      owner: input.owner,
      repo: input.repository,
      name: input.name,
      head_sha: input.headSha,
      status: 'in_progress',
      details_url: input.detailsUrl,
      ...(input.output ? { output: toGitHubCheckRunOutput(input.output) } : {}),
    }),
  );

  return {
    id: response.data.id,
    htmlUrl: response.data.html_url ?? null,
  };
}

export async function updateCheckRun(
  context: GithubServiceContext,
  input: UpdateCheckRunInput,
): Promise<{ id: number; htmlUrl: string | null }> {
  validateUpdateCheckRunInput(input);
  const octokit = await requireInstallationOctokit(context, input.installationId);
  const annotationBatches = chunkAnnotations(input.output?.annotations ?? []);
  const outputWithoutAnnotations = input.output
    ? toGitHubCheckRunOutput({ ...input.output, annotations: [] })
    : undefined;

  const firstBatch = annotationBatches[0] ?? [];
  let response = await withGitHubWriteErrorClassification(() =>
    octokit.rest.checks.update({
      owner: input.owner,
      repo: input.repository,
      check_run_id: input.checkRunId,
      status: input.status,
      conclusion: input.conclusion,
      completed_at: input.completedAt,
      ...(outputWithoutAnnotations
        ? {
            output: {
              ...outputWithoutAnnotations,
              annotations: firstBatch.map(toGitHubAnnotation),
            },
          }
        : {}),
    }),
  );

  for (const batch of annotationBatches.slice(1)) {
    response = await withGitHubWriteErrorClassification(() =>
      octokit.rest.checks.update({
        owner: input.owner,
        repo: input.repository,
        check_run_id: input.checkRunId,
        output: {
          title: input.output!.title,
          summary: input.output!.summary,
          text: input.output!.text,
          annotations: batch.map(toGitHubAnnotation),
        },
      }),
    );
  }

  return {
    id: response.data.id,
    htmlUrl: response.data.html_url ?? null,
  };
}

export function validateCreateCheckRunInput(input: CreateCheckRunInput): void {
  validateRepositoryTarget(input.owner, input.repository);
  validateNonEmptyString(input.name, 'name');
  validateNonEmptyString(input.headSha, 'headSha');
  if (input.detailsUrl !== undefined) validateNonEmptyString(input.detailsUrl, 'detailsUrl');
  if (input.output) validateCheckRunOutput(input.output);
}

export function validateUpdateCheckRunInput(input: UpdateCheckRunInput): void {
  validateRepositoryTarget(input.owner, input.repository);
  validatePositiveInteger(input.checkRunId, 'checkRunId');
  if (input.status !== undefined) validateStatus(input.status);
  if (input.conclusion !== undefined) validateConclusion(input.conclusion);
  if (
    input.status !== undefined &&
    input.status !== 'completed' &&
    input.conclusion !== undefined
  ) {
    throw new ValidationError('A Check Run conclusion can only be set when status is completed.');
  }
  if (input.output) validateCheckRunOutput(input.output);
}

function validateCheckRunOutput(output: CheckRunOutputInput): void {
  validateNonEmptyString(output.title, 'output.title');
  validateNonEmptyString(output.summary, 'output.summary');
  if (output.text !== undefined) validateNonEmptyString(output.text, 'output.text');
  for (const annotation of output.annotations ?? []) {
    validateAnnotation(annotation);
  }
}

function validateAnnotation(annotation: CheckRunAnnotationInput): void {
  validateNonEmptyString(annotation.path, 'annotation.path');
  validatePositiveInteger(annotation.startLine, 'annotation.startLine');
  validatePositiveInteger(annotation.endLine, 'annotation.endLine');
  if (annotation.endLine < annotation.startLine) {
    throw new ValidationError('annotation.endLine must be greater than or equal to startLine.');
  }
  validateAnnotationLevel(annotation.annotationLevel);
  validateNonEmptyString(annotation.message, 'annotation.message');
  if (annotation.title !== undefined) validateNonEmptyString(annotation.title, 'annotation.title');
  if (annotation.rawDetails !== undefined) {
    validateNonEmptyString(annotation.rawDetails, 'annotation.rawDetails');
  }
}

function chunkAnnotations(annotations: CheckRunAnnotationInput[]): CheckRunAnnotationInput[][] {
  const batches: CheckRunAnnotationInput[][] = [];
  for (let index = 0; index < annotations.length; index += MAX_CHECK_RUN_ANNOTATIONS_PER_REQUEST) {
    batches.push(annotations.slice(index, index + MAX_CHECK_RUN_ANNOTATIONS_PER_REQUEST));
  }
  return batches;
}

function toGitHubCheckRunOutput(output: CheckRunOutputInput) {
  return {
    title: output.title,
    summary: output.summary,
    text: output.text,
    annotations: (output.annotations ?? []).map(toGitHubAnnotation),
  };
}

function toGitHubAnnotation(annotation: CheckRunAnnotationInput) {
  return {
    path: annotation.path,
    start_line: annotation.startLine,
    end_line: annotation.endLine,
    annotation_level: annotation.annotationLevel,
    message: annotation.message.trim(),
    title: annotation.title,
    raw_details: annotation.rawDetails,
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

function validatePositiveInteger(value: number | undefined, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be a positive integer.`);
  }
}

function validateStatus(status: string): void {
  if (status !== 'queued' && status !== 'in_progress' && status !== 'completed') {
    throw new ValidationError('status must be queued, in_progress, or completed.');
  }
}

function validateConclusion(conclusion: string): void {
  const valid = new Set([
    'success',
    'failure',
    'neutral',
    'cancelled',
    'skipped',
    'timed_out',
    'action_required',
  ]);
  if (!valid.has(conclusion)) {
    throw new ValidationError('conclusion is not a valid Check Run conclusion.');
  }
}

function validateAnnotationLevel(level: string): void {
  if (level !== 'notice' && level !== 'warning' && level !== 'failure') {
    throw new ValidationError('annotation.annotationLevel must be notice, warning, or failure.');
  }
}
