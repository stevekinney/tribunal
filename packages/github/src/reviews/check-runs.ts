import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import {
  validateNonEmptyString,
  validatePositiveInteger,
  validateRepositoryTarget,
  withGitHubWriteErrorClassification,
} from './errors.js';

const MAX_CHECK_RUN_ANNOTATIONS_PER_REQUEST = 50;
// GitHub enforces 65,535 bytes on `output.summary`/`output.text`; stay under it
// with headroom for the truncation notice appended below.
const MAX_CHECK_RUN_OUTPUT_TEXT_BYTES = 60_000;
// GitHub's documented best practice: space out sequential mutating requests to
// the same resource by at least a second.
const ANNOTATION_BATCH_SPACING_MS = 1_000;

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

/**
 * A Check Run action button. GitHub enforces label/identifier <= 20
 * characters and description <= 40 characters, and accepts at most 3.
 */
export interface CheckRunActionInput {
  label: string;
  description: string;
  identifier: string;
}

/** Inputs for creating a Check Run. Defaults to status `in_progress` when not specified. */
export interface CreateCheckRunInput {
  installationId: number;
  owner: string;
  repository: string;
  name: string;
  headSha: string;
  /** Creation-time status. Defaults to `in_progress`; use `queued` for intent-time creation. */
  status?: Extract<CheckRunStatus, 'queued' | 'in_progress'>;
  /** Correlates the Check Run with the Tribunal intent/run id that created it. */
  externalId?: string;
  detailsUrl?: string;
  output?: CheckRunOutputInput;
  actions?: CheckRunActionInput[];
}

export interface UpdateCheckRunInput {
  installationId: number;
  owner: string;
  repository: string;
  checkRunId: number;
  status?: CheckRunStatus;
  conclusion?: CheckRunConclusion;
  /** Set when transitioning to `in_progress`, so the Check Run reports when work began. */
  startedAt?: string;
  completedAt?: string;
  output?: CheckRunOutputInput;
  actions?: CheckRunActionInput[];
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
      status: input.status ?? 'in_progress',
      external_id: input.externalId,
      details_url: input.detailsUrl,
      ...(input.output ? { output: toGitHubCheckRunOutput(input.output) } : {}),
      ...(input.actions ? { actions: input.actions.map(toGitHubCheckRunAction) } : {}),
    }),
  );

  return {
    id: response.data.id,
    htmlUrl: response.data.html_url ?? null,
  };
}

export interface UpdateCheckRunOptions {
  /** Injectable delay between annotation-batch PATCHes; defaults to a real `setTimeout` sleep. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function updateCheckRun(
  context: GithubServiceContext,
  input: UpdateCheckRunInput,
  options: UpdateCheckRunOptions = {},
): Promise<{ id: number; htmlUrl: string | null }> {
  validateUpdateCheckRunInput(input);
  const sleep = options.sleep ?? delay;
  const octokit = await requireInstallationOctokit(context, input.installationId);
  const annotationBatches = chunkAnnotations(input.output?.annotations ?? []);
  const truncatedOutput = input.output ? truncateCheckRunOutputText(input.output) : undefined;
  const outputWithoutAnnotations = truncatedOutput
    ? toGitHubCheckRunOutput({ ...truncatedOutput, annotations: [] })
    : undefined;

  const firstBatch = annotationBatches[0] ?? [];
  let response = await withGitHubWriteErrorClassification(() =>
    octokit.rest.checks.update({
      owner: input.owner,
      repo: input.repository,
      check_run_id: input.checkRunId,
      status: input.status,
      conclusion: input.conclusion,
      started_at: input.startedAt,
      completed_at: input.completedAt,
      ...(outputWithoutAnnotations
        ? {
            output: {
              ...outputWithoutAnnotations,
              annotations: firstBatch.map(toGitHubAnnotation),
            },
          }
        : {}),
      ...(input.actions ? { actions: input.actions.map(toGitHubCheckRunAction) } : {}),
    }),
  );

  for (const batch of annotationBatches.slice(1)) {
    await sleep(ANNOTATION_BATCH_SPACING_MS);
    response = await withGitHubWriteErrorClassification(() =>
      octokit.rest.checks.update({
        owner: input.owner,
        repo: input.repository,
        check_run_id: input.checkRunId,
        output: {
          title: truncatedOutput!.title,
          summary: truncatedOutput!.summary,
          text: truncatedOutput!.text,
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
  if (input.status !== undefined) validateCreationStatus(input.status);
  if (input.externalId !== undefined) validateNonEmptyString(input.externalId, 'externalId');
  if (input.detailsUrl !== undefined) validateNonEmptyString(input.detailsUrl, 'detailsUrl');
  if (input.output) validateCheckRunOutput(input.output);
  if (input.actions) validateCheckRunActions(input.actions);
}

function validateCreationStatus(status: string): void {
  if (status !== 'queued' && status !== 'in_progress') {
    throw new ValidationError('Check Run creation status must be queued or in_progress.');
  }
}

export function validateUpdateCheckRunInput(input: UpdateCheckRunInput): void {
  validateRepositoryTarget(input.owner, input.repository);
  validatePositiveInteger(input.checkRunId, 'checkRunId');
  if (input.status !== undefined) validateStatus(input.status);
  if (input.startedAt !== undefined) validateNonEmptyString(input.startedAt, 'startedAt');
  if (input.conclusion !== undefined) validateConclusion(input.conclusion);
  if (input.conclusion !== undefined && input.status === undefined) {
    throw new ValidationError('A Check Run conclusion requires status completed.');
  }
  if (
    input.status !== undefined &&
    input.status !== 'completed' &&
    input.conclusion !== undefined
  ) {
    throw new ValidationError('A Check Run conclusion can only be set when status is completed.');
  }
  if (input.output) validateCheckRunOutput(input.output);
  if (input.actions) validateCheckRunActions(input.actions);
}

function validateCheckRunActions(actions: CheckRunActionInput[]): void {
  if (actions.length > 3) {
    throw new ValidationError('A Check Run accepts at most 3 actions.');
  }
  for (const action of actions) {
    validateNonEmptyString(action.label, 'action.label');
    if (action.label.length > 20) {
      throw new ValidationError('action.label must be 20 characters or fewer.');
    }
    validateNonEmptyString(action.description, 'action.description');
    if (action.description.length > 40) {
      throw new ValidationError('action.description must be 40 characters or fewer.');
    }
    validateNonEmptyString(action.identifier, 'action.identifier');
    if (action.identifier.length > 20) {
      throw new ValidationError('action.identifier must be 20 characters or fewer.');
    }
  }
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

/**
 * GitHub enforces `output.summary`/`output.text` at 65,535 bytes, measured in
 * UTF-8 bytes, not JS string length (astral-plane and multi-byte characters
 * would otherwise silently overrun the limit). Truncate at a UTF-16 code-unit
 * boundary that never splits a surrogate pair, then append a notice.
 */
function truncateCheckRunOutputText(output: CheckRunOutputInput): CheckRunOutputInput {
  return {
    ...output,
    summary: truncateToByteLimit(output.summary),
    text: output.text === undefined ? undefined : truncateToByteLimit(output.text),
  };
}

function truncateToByteLimit(text: string, maxBytes = MAX_CHECK_RUN_OUTPUT_TEXT_BYTES): string {
  if (byteLength(text) <= maxBytes) return text;

  const notice = '\n\n_...truncated (output exceeded the Check Run size limit)._';
  const noticeBytes = byteLength(notice);
  const budget = Math.max(0, maxBytes - noticeBytes);

  let truncated = text;
  while (byteLength(truncated) > budget) {
    // Shrink by whole UTF-16 code units, stepping past a low surrogate so we
    // never split a surrogate pair (which would produce invalid UTF-8).
    let nextLength = truncated.length - 1;
    const charCode = truncated.charCodeAt(nextLength);
    if (charCode >= 0xdc00 && charCode <= 0xdfff) nextLength -= 1;
    truncated = truncated.slice(0, Math.max(0, nextLength));
  }

  return `${truncated}${notice}`;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function toGitHubCheckRunAction(action: CheckRunActionInput) {
  return {
    label: action.label,
    description: action.description,
    identifier: action.identifier,
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
