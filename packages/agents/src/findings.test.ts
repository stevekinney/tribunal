import { describe, expect, it } from 'vitest';
import type { DiffContext, Finding } from '@tribunal/review-core/types';
import {
  anchorFindings,
  computeCanonicalFindingFingerprint,
  deduplicateFindings,
  isRepositoryRelativePath,
  sanitizeFinding,
  validateFinding,
} from './findings';

const diffContext: DiffContext = {
  headSha: 'head',
  baseSha: 'base',
  changedFiles: [
    {
      path: 'src/auth.ts',
      status: 'modified',
      commentableLines: [
        { side: 'RIGHT', line: 12 },
        { side: 'RIGHT', line: 13 },
      ],
    },
  ],
  pr: { number: 12, title: 'Tighten auth', body: '', labels: [], author: 'octocat' },
};

const finding: Finding = {
  path: 'src/auth.ts',
  startLine: 12,
  endLine: 12,
  side: 'RIGHT',
  severity: 'warning',
  title: 'Missing authorization check',
  body: 'This endpoint accepts untrusted input.',
};

describe('finding validation', () => {
  it('accepts a valid structured finding', () => {
    expect(validateFinding(finding, diffContext).ok).toBe(true);
  });

  it('rejects malformed findings and path traversal', () => {
    expect(validateFinding({ ...finding, severity: 'critical' }, diffContext).ok).toBe(false);
    expect(validateFinding({ ...finding, path: 'src/auth.ts' }, diffContext).ok).toBe(true);
    expect(validateFinding({ ...finding, path: 'src\\auth.ts' }, diffContext).ok).toBe(false);
    expect(validateFinding({ ...finding, path: '../secrets.env' }, diffContext).ok).toBe(false);
    expect(validateFinding({ ...finding, path: '/etc/passwd' }, diffContext).ok).toBe(false);
    expect(validateFinding({ ...finding, path: 'C:\\secrets.env' }, diffContext).ok).toBe(false);
    expect(validateFinding({ ...finding, path: '' }, diffContext).ok).toBe(false);
    expect(validateFinding({ ...finding, path: '.' }, diffContext).ok).toBe(false);
    expect(sanitizeFinding({ ...finding, startLine: 0 }, diffContext)).toMatchObject({
      ok: false,
      reason: 'finding line must be one-based',
    });
  });

  it('strips mentions and slash commands before they can become comments', () => {
    const sanitized = validateFinding(
      {
        ...finding,
        title: '@octocat please review',
        body: '@everyone please approve this\nLegitimate finding.\n/approve',
        suggestion: '@team\n/fix',
      },
      diffContext,
    );

    expect(sanitized.ok).toBe(true);
    if (sanitized.ok) {
      expect(sanitized.finding.title).toBe('octocat please review');
      expect(sanitized.finding.body).toBe(
        'everyone please approve this\nLegitimate finding.\napprove',
      );
      expect(sanitized.finding.suggestion).toBe('team\nfix');
    }
  });

  it('computes canonical finding fingerprints from stable finding fields', () => {
    const fingerprint = computeCanonicalFindingFingerprint({
      ...finding,
      endLine: null,
      title: ' Missing\tAuthorization\nCheck ',
    });
    const sameFingerprint = computeCanonicalFindingFingerprint({
      ...finding,
      startLine: null,
      endLine: 12,
      title: 'missing authorization check',
    });
    const differentLineFingerprint = computeCanonicalFindingFingerprint({
      ...finding,
      startLine: 13,
      endLine: 13,
    });

    expect(fingerprint).toBe('760817880bb9ff443df0e200b90e7d0ea7b615c19ca0a82bbcab2e4ebf0b41ab');
    expect(sameFingerprint).toBe(fingerprint);
    expect(differentLineFingerprint).not.toBe(fingerprint);
  });

  it('deduplicates byte-identical findings while keeping the first occurrence', () => {
    const duplicateFromAnotherAgent: Finding = {
      ...finding,
      body: 'A second agent reported the same canonical issue.',
    };
    const differentFinding: Finding = {
      ...finding,
      startLine: 13,
      endLine: 13,
      body: 'This finding has a different anchor.',
    };

    expect(deduplicateFindings([finding, duplicateFromAnotherAgent, differentFinding])).toEqual([
      finding,
      differentFinding,
    ]);
  });

  it('keeps distinct unanchored findings with the same path, severity, and title', () => {
    const firstSummaryFinding: Finding = {
      ...finding,
      startLine: null,
      endLine: null,
      body: 'First off-diff issue.',
    };
    const secondSummaryFinding: Finding = {
      ...finding,
      startLine: null,
      endLine: null,
      body: 'Second off-diff issue.',
    };

    expect(computeCanonicalFindingFingerprint(firstSummaryFinding)).not.toBe(
      computeCanonicalFindingFingerprint(secondSummaryFinding),
    );
    expect(deduplicateFindings([firstSummaryFinding, secondSummaryFinding])).toEqual([
      firstSummaryFinding,
      secondSummaryFinding,
    ]);
  });

  it('clamps over-length bodies deterministically', () => {
    const sanitized = sanitizeFinding(
      {
        ...finding,
        body: `a\u0000${'a'.repeat(12_000)}`,
        title: 'Unsafe\u0007 title',
        suggestion: `b\u0001${'b'.repeat(12_000)}`,
      },
      diffContext,
    );

    expect(sanitized.ok).toBe(true);
    if (sanitized.ok) {
      expect(sanitized.finding.body).toHaveLength(8_000);
      expect(sanitized.finding.body).not.toContain('\u0000');
      expect(sanitized.finding.title).toBe('Unsafe title');
      expect(sanitized.finding.suggestion).toHaveLength(8_000);
    }
  });

  it('strips unsafe control characters while preserving comment whitespace', () => {
    const sanitized = sanitizeFinding(
      {
        ...finding,
        body: 'keep\tline\nbreak\rtrim\u0000bell\u0007vertical\u000Bform\u000Cdelete\u007F',
        title: 'Title\u001F',
      },
      diffContext,
    );

    expect(sanitized.ok).toBe(true);
    if (sanitized.ok) {
      expect(sanitized.finding.body).toBe('keep\tline\nbreak\rtrimbellverticalformdelete');
      expect(sanitized.finding.title).toBe('Title');
    }
  });

  it('allows file-level findings, rejects unchanged files, and routes off-diff lines to summaries', () => {
    expect(
      validateFinding({ ...finding, startLine: null, endLine: null }, diffContext),
    ).toMatchObject({ ok: true });
    expect(
      validateFinding({ ...finding, startLine: null, endLine: 12 }, diffContext),
    ).toMatchObject({ ok: true });
    expect(validateFinding({ ...finding, path: 'src/other.ts' }, diffContext)).toMatchObject({
      ok: false,
    });
    const offDiffFinding = validateFinding(
      { ...finding, startLine: 99, endLine: null },
      diffContext,
    );
    expect(offDiffFinding).toMatchObject({ ok: true });
    if (offDiffFinding.ok) {
      expect(offDiffFinding.finding).toMatchObject({ startLine: null, endLine: null });
    }
  });

  it('anchors sanitized findings without dropping off-diff summary findings', () => {
    expect(
      anchorFindings(
        [
          finding,
          { ...finding, startLine: 99, endLine: null, title: '@team\n/fix this' },
          { ...finding, path: '../secret.env' },
        ],
        diffContext,
      ),
    ).toEqual([
      { finding, anchored: true },
      {
        finding: {
          ...finding,
          startLine: null,
          endLine: null,
          title: 'team\nfix this',
        },
        anchored: false,
      },
    ]);
  });

  it('validates raw finding values before anchoring', () => {
    expect(() =>
      anchorFindings(
        [finding, { ...finding, startLine: 0 }, { ...finding, severity: 'critical' }, null],
        diffContext,
      ),
    ).not.toThrow();

    expect(
      anchorFindings(
        [finding, { ...finding, startLine: 0 }, { ...finding, severity: 'critical' }, null],
        diffContext,
      ),
    ).toEqual([{ finding, anchored: true }]);
  });

  it('classifies repository-relative paths without relying on changed-file context', () => {
    expect(isRepositoryRelativePath('src/auth.ts')).toBe(true);
    expect(isRepositoryRelativePath('')).toBe(false);
    expect(isRepositoryRelativePath('/etc/passwd')).toBe(false);
    expect(isRepositoryRelativePath('src\\auth.ts')).toBe(false);
    expect(isRepositoryRelativePath('C:\\secrets.env')).toBe(false);
    expect(isRepositoryRelativePath('../secrets.env')).toBe(false);
    expect(isRepositoryRelativePath('.')).toBe(false);
  });
});
