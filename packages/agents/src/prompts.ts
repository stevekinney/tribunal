import type { ChangedFile, DiffContext, Finding } from '@tribunal/review-core/types';

export type ReviewPromptInput = {
  agentDescription: string;
  agentBody: string;
  diffContext: DiffContext;
  guidelines: string;
};

/**
 * Builds the per-agent review prompt.
 *
 * Section order matters for prompt-cache reuse: every section before "Agent role"
 * is byte-identical across every agent in a run (same diff context, same
 * guidelines), so the Agent SDK's automatic prompt caching lets the first agent
 * pay the cache-write cost and every subsequent agent + verifier pay only the
 * cheaper cache-read rate. Only the final "Agent role" section varies per agent —
 * it must stay last so it never breaks the shared prefix.
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  return [
    'Review this pull request from the checked-out repository.',
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
    '',
    'Agent role',
    input.agentDescription,
    '',
    'Agent instructions',
    input.agentBody,
  ].join('\n');
}

export type TriagePromptInput = {
  diffContext: DiffContext;
  guidelines: string;
  availableAgentSlugs: string[];
};

/**
 * Builds the triage agent's prompt: classify the pull request, decide whether
 * it is worth reviewing at all, and flag risk surfaces (auth/crypto/concurrency)
 * that warrant escalating a specialist's model.
 */
export function buildTriagePrompt(input: TriagePromptInput): string {
  return [
    'Classify this pull request before any specialist reviewer runs.',
    '',
    'Triage contract',
    [
      '- Decide `skip: true` only when there is nothing reviewable: pure renames,',
      '  formatting-only changes, or generated/vendored churn that survived path filters.',
      '- List `riskFlags` for surfaces that deserve deeper scrutiny (for example',
      '  "auth", "crypto", "concurrency") based on the changed files and diff content.',
      '- Do not report individual findings; that is the specialists’ job.',
      `- Available specialists for this run: ${input.availableAgentSlugs.join(', ') || '(none configured)'}.`,
    ].join('\n'),
    '',
    'Review guidelines',
    input.guidelines,
    '',
    formatPullRequestContext(input.diffContext),
    '',
    'Pull request diff',
    formatChangedFiles(input.diffContext.changedFiles),
  ].join('\n');
}

export type VerificationPromptInput = {
  diffContext: DiffContext;
  finding: Finding;
};

/**
 * Builds the per-finding adversarial verification prompt: try to refute the
 * candidate finding. A finding survives only with a concrete file:line
 * citation in actual source, not an inference from naming or convention.
 */
export function buildVerificationPrompt(input: VerificationPromptInput): string {
  return [
    'Verify this candidate code review finding by trying to refute it.',
    '',
    'Verification contract',
    [
      '- Read the actual source at the cited path and line before deciding.',
      '- Mark `verified: true` only if the finding cites a concrete file:line in',
      '  real source that supports the claim.',
      '- Mark `verified: false` if the citation is wrong, the issue does not exist,',
      '  or the finding is an inference from naming/convention rather than the code.',
      '- Explain your decision in `note`, referencing what you read.',
    ].join('\n'),
    '',
    'Candidate finding',
    `Path: ${input.finding.path}`,
    `Line: ${input.finding.startLine ?? input.finding.endLine ?? '(file-level)'}`,
    `Severity: ${input.finding.severity}`,
    `Title: ${input.finding.title}`,
    `Body: ${input.finding.body}`,
    '',
    formatPullRequestContext(input.diffContext),
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
