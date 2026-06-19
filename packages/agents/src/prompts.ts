import type { ChangedFile, DiffContext } from '@tribunal/review-core/types';

export type ReviewPromptInput = {
  agentDescription: string;
  agentBody: string;
  diffContext: DiffContext;
  guidelines: string;
};

export function buildReviewPrompt(input: ReviewPromptInput): string {
  return [
    'Review this pull request from the checked-out repository.',
    '',
    'Agent description',
    input.agentDescription,
    '',
    'Agent instructions',
    input.agentBody,
    '',
    'Review contract',
    [
      '- Report only confirmed findings as structured data.',
      '- Do not modify files.',
      '- Do not run shell commands.',
      '- Use record_finding for each finding.',
      '- Each finding must include path, startLine, endLine, side, severity, title, body, and optional suggestion.',
    ].join('\n'),
    '',
    'Review guidelines',
    input.guidelines,
    '',
    formatPullRequestContext(input.diffContext),
    '',
    formatChangedSinceLast(input.diffContext.changedSinceLast ?? []),
    '',
    'Pull request diff',
    formatChangedFiles(input.diffContext.changedFiles),
  ].join('\n');
}

function formatPullRequestContext(diffContext: DiffContext): string {
  return [
    'Pull request context',
    `Number: ${diffContext.pr.number}`,
    `Author: ${diffContext.pr.author}`,
    `Title: ${diffContext.pr.title}`,
    `Labels: ${diffContext.pr.labels.join(', ') || '(none)'}`,
    `Base SHA: ${diffContext.baseSha}`,
    `Head SHA: ${diffContext.headSha}`,
    ...(diffContext.prevHeadSha === undefined
      ? []
      : [`Previous head SHA: ${diffContext.prevHeadSha}`]),
    '',
    diffContext.pr.body || '(no pull request body)',
  ].join('\n');
}

function formatChangedSinceLast(changedSinceLast: readonly ChangedFile[]): string {
  if (changedSinceLast.length === 0) {
    return 'Changed since the previous review\n(none)';
  }

  return ['Changed since the previous review', formatChangedFiles(changedSinceLast)].join('\n');
}

function formatChangedFiles(changedFiles: readonly ChangedFile[]): string {
  if (changedFiles.length === 0) return '(no changed files)';

  return changedFiles.map(formatChangedFile).join('\n\n');
}

function formatChangedFile(file: ChangedFile): string {
  return [
    `File: ${file.path}`,
    `Status: ${file.status}`,
    `Commentable lines: ${file.commentableLines
      .map((line) => `${line.side}:${line.line}`)
      .join(', ')}`,
    'Patch:',
    file.patch ?? '(patch unavailable)',
  ].join('\n');
}
