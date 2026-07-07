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

  const isFileLevelFinding = finding.startLine === null && finding.endLine === null;
  const commentable = isFileLevelFinding || isFindingOnCommentableLine(finding, changedFile);

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
    ...(isUnanchoredFinding(finding) ? { normalizedBody: normalizeFindingBody(finding.body) } : {}),
  });

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Merges near-duplicate findings reported by different agents: same path,
 * overlapping line range, and similar normalized title (word-overlap
 * similarity >= 0.5). Keeps the highest-severity, most-specific finding from
 * each group — exact-fingerprint dedup (`deduplicateFindings`) already
 * handles identical findings; this handles the fuzzier cross-agent case
 * where two specialists describe the same issue differently.
 *
 * The surviving finding in each group carries `mergedFingerprints`: the
 * canonical fingerprints of every finding absorbed into it (including ones
 * absorbed transitively across more than two merges). Phase 3's
 * carried-forward dedup needs this to match a re-reported finding against
 * either the surviving fingerprint or any fingerprint it absorbed.
 */
export function mergeNearDuplicateFindings(findings: readonly Finding[]): Finding[] {
  const merged: Array<{ finding: Finding; mergedFingerprints: string[] }> = [];

  for (const finding of findings) {
    const duplicateIndex = merged.findIndex((candidate) =>
      isNearDuplicateFinding(candidate.finding, finding),
    );
    if (duplicateIndex === -1) {
      merged.push({ finding, mergedFingerprints: [] });
      continue;
    }

    const entry = merged[duplicateIndex]!;
    const winner = pickMoreSpecificFinding(entry.finding, finding);
    const absorbedFingerprint = computeCanonicalFindingFingerprint(
      winner === entry.finding ? finding : entry.finding,
    );
    merged[duplicateIndex] = {
      finding: winner,
      mergedFingerprints: [...entry.mergedFingerprints, absorbedFingerprint],
    };
  }

  return merged.map(({ finding, mergedFingerprints }) =>
    mergedFingerprints.length === 0 ? finding : { ...finding, mergedFingerprints },
  );
}

/** Orders findings for posting: highest severity first, then path, then line. */
export function compareFindingsForPosting(left: Finding, right: Finding): number {
  const severityDifference = severityRank(right.severity) - severityRank(left.severity);
  if (severityDifference !== 0) return severityDifference;
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  return normalizedFindingLine(left) - normalizedFindingLine(right);
}

function isNearDuplicateFinding(left: Finding, right: Finding): boolean {
  if (left.path !== right.path) return false;
  if (!findingLineRangesOverlap(left, right)) return false;
  return findingTitleSimilarity(left.title, right.title) >= 0.5;
}

function findingLineRangesOverlap(left: Finding, right: Finding): boolean {
  const leftRange = normalizedFindingLineRange(left);
  const rightRange = normalizedFindingLineRange(right);
  if (leftRange === null || rightRange === null) return leftRange === rightRange;
  return leftRange[0] <= rightRange[1] && rightRange[0] <= leftRange[1];
}

function normalizedFindingLineRange(finding: Finding): [number, number] | null {
  if (finding.startLine === null && finding.endLine === null) return null;
  const start = finding.startLine ?? finding.endLine ?? 0;
  const end = finding.endLine ?? finding.startLine ?? 0;
  return [Math.min(start, end), Math.max(start, end)];
}

function normalizedFindingLine(finding: Finding): number {
  return finding.endLine ?? finding.startLine ?? 0;
}

function findingTitleSimilarity(left: string, right: string): number {
  const leftWords = new Set(normalizeToWords(left));
  const rightWords = new Set(normalizeToWords(right));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;

  const intersectionSize = [...leftWords].filter((word) => rightWords.has(word)).length;
  const unionSize = new Set([...leftWords, ...rightWords]).size;
  return intersectionSize / unionSize;
}

function normalizeToWords(value: string): string[] {
  return stripControlCharacters(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);
}

function pickMoreSpecificFinding(left: Finding, right: Finding): Finding {
  const severityDifference = severityRank(right.severity) - severityRank(left.severity);
  if (severityDifference !== 0) return severityDifference > 0 ? right : left;

  const leftHasSuggestion = left.suggestion !== undefined;
  const rightHasSuggestion = right.suggestion !== undefined;
  if (leftHasSuggestion !== rightHasSuggestion) return rightHasSuggestion ? right : left;

  return left.title <= right.title ? left : right;
}

function severityRank(severity: Finding['severity']): number {
  if (severity === 'error') return 2;
  if (severity === 'warning') return 1;
  return 0;
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

function isUnanchoredFinding(finding: Finding): boolean {
  return finding.startLine === null && finding.endLine === null;
}

function normalizeFindingTitle(title: string): string {
  return stripControlCharacters(title).trim().replace(/\s+/gu, ' ').toLowerCase();
}

function normalizeFindingBody(body: string): string {
  return stripControlCharacters(body).trim().replace(/\s+/gu, ' ');
}
