import { createHash } from 'node:crypto';
import path from 'node:path';
import { findingSchema } from '@tribunal/review-core/schemas';
import type { DiffContext, Finding } from '@tribunal/review-core/types';

const MAXIMUM_COMMENT_BODY_LENGTH = 8_000;

export type FindingValidationResult =
  | { ok: true; finding: Finding }
  | { ok: false; reason: string };

export type AnchoredFinding = {
  finding: Finding;
  anchored: boolean;
};

/** Validates and sanitizes a structured finding before it can become review output. */
export function validateFinding(input: unknown, diffContext: DiffContext): FindingValidationResult {
  const parsed = findingSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, reason: 'finding failed schema validation' };
  }

  return sanitizeFinding(parsed.data, diffContext);
}

/** Applies repository path, diff-line, body safety, and length checks to a finding. */
export function sanitizeFinding(
  finding: Finding,
  diffContext: DiffContext,
): FindingValidationResult {
  if (!isRepositoryRelativePath(finding.path)) {
    return { ok: false, reason: 'finding path escapes the repository' };
  }

  const changedFile = diffContext.changedFiles.find((file) => file.path === finding.path);
  if (changedFile === undefined) {
    return { ok: false, reason: 'finding path is outside the pull request diff' };
  }

  if (finding.startLine === 0 || finding.endLine === 0) {
    return { ok: false, reason: 'finding line must be one-based' };
  }

  const body = sanitizeCommentText(finding.body).slice(0, MAXIMUM_COMMENT_BODY_LENGTH);
  const title = sanitizeCommentText(finding.title);
  const suggestion =
    finding.suggestion === undefined
      ? undefined
      : sanitizeCommentText(finding.suggestion).slice(0, MAXIMUM_COMMENT_BODY_LENGTH);

  const line = normalizeFindingLine(finding);
  const commentable = line === 0 || isFindingOnCommentableLine(finding, changedFile);

  return {
    ok: true,
    finding: {
      ...finding,
      ...(!commentable ? { startLine: null, endLine: null } : {}),
      body,
      title,
      suggestion,
    },
  };
}

function isFindingOnCommentableLine(
  finding: Finding,
  changedFile: DiffContext['changedFiles'][number],
): boolean {
  const line = finding.endLine ?? finding.startLine;
  if (line === null) return true;

  return changedFile.commentableLines.some(
    (commentableLine) => commentableLine.side === finding.side && commentableLine.line === line,
  );
}

export function anchorFindings(
  findings: readonly unknown[],
  diffContext: DiffContext,
): AnchoredFinding[] {
  const anchoredFindings: AnchoredFinding[] = [];

  for (const finding of findings) {
    const validated = validateFinding(finding, diffContext);
    if (!validated.ok) continue;
    anchoredFindings.push({
      finding: validated.finding,
      anchored: validated.finding.startLine !== null || validated.finding.endLine !== null,
    });
  }

  return anchoredFindings;
}

export function isRepositoryRelativePath(candidatePath: string): boolean {
  if (candidatePath.length === 0) return false;
  if (candidatePath.includes('\\')) return false;
  if (path.posix.isAbsolute(candidatePath) || path.win32.isAbsolute(candidatePath)) return false;

  const normalizedPath = path.posix.normalize(candidatePath);
  return normalizedPath !== '..' && !normalizedPath.startsWith('../') && normalizedPath !== '.';
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === undefined ||
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint !== 0x7f)
      );
    })
    .join('');
}

function sanitizeCommentText(value: string): string {
  return stripControlCharacters(value)
    .replace(/(^|[^\w])@([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\b/giu, '$1$2')
    .replace(/^(\s*)\/(\S+)/gmu, '$1$2');
}

export function computeCanonicalFindingFingerprint(finding: Finding): string {
  const payload = JSON.stringify({
    path: finding.path,
    normalizedLine: normalizeFindingLine(finding),
    severity: finding.severity,
    normalizedTitle: normalizeFindingTitle(finding.title),
  });

  return createHash('sha256').update(payload).digest('hex');
}

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const seenFingerprints = new Set<string>();
  const deduplicatedFindings: Finding[] = [];

  for (const finding of findings) {
    const fingerprint = computeCanonicalFindingFingerprint(finding);
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    deduplicatedFindings.push(finding);
  }

  return deduplicatedFindings;
}

function normalizeFindingLine(finding: Finding): number {
  return finding.endLine ?? finding.startLine ?? 0;
}

function normalizeFindingTitle(title: string): string {
  return stripControlCharacters(title).trim().replace(/\s+/gu, ' ').toLowerCase();
}
