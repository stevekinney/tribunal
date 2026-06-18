import { createHash } from 'node:crypto';
import path from 'node:path';
import { findingSchema } from '@tribunal/review-core/schemas';
import type { DiffContext, Finding } from '@tribunal/review-core/types';

const MAXIMUM_COMMENT_BODY_LENGTH = 8_000;

export type FindingValidationResult =
  | { ok: true; finding: Finding }
  | { ok: false; reason: string };

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

  if (containsUnsafeCommentAction(finding.body) || containsUnsafeCommentAction(finding.title)) {
    return { ok: false, reason: 'finding contains an unsafe mention or slash command' };
  }

  if (!isFindingOnChangedFile(finding, diffContext)) {
    return { ok: false, reason: 'finding does not point to a commentable diff line' };
  }

  return {
    ok: true,
    finding: {
      ...finding,
      body: stripControlCharacters(finding.body).slice(0, MAXIMUM_COMMENT_BODY_LENGTH),
      title: stripControlCharacters(finding.title),
      suggestion:
        finding.suggestion === undefined
          ? undefined
          : stripControlCharacters(finding.suggestion).slice(0, MAXIMUM_COMMENT_BODY_LENGTH),
    },
  };
}

function isFindingOnChangedFile(finding: Finding, diffContext: DiffContext): boolean {
  const changedFile = diffContext.changedFiles.find((file) => file.path === finding.path);
  if (changedFile === undefined) return false;
  if (finding.startLine === null && finding.endLine === null) return true;

  const line = finding.endLine ?? finding.startLine;

  return changedFile.commentableLines.some(
    (commentableLine) => commentableLine.side === finding.side && commentableLine.line === line,
  );
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

function containsUnsafeCommentAction(value: string): boolean {
  return /(^|[^\w])@[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\b/iu.test(value) || /^\s*\/\S+/m.test(value);
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

function normalizeFindingLine(finding: Finding): number {
  return finding.endLine ?? finding.startLine ?? 0;
}

function normalizeFindingTitle(title: string): string {
  return stripControlCharacters(title).trim().replace(/\s+/gu, ' ').toLowerCase();
}
