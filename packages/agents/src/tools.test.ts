import { describe, expect, it } from 'vitest';
import type { DiffContext, Finding } from '@tribunal/review-core/types';
import { createTribunalReviewTools } from './tools';

const finding: Finding = {
  path: 'src/auth.ts',
  startLine: 4,
  endLine: 4,
  side: 'RIGHT',
  severity: 'error',
  title: 'Unsafe comparison',
  body: 'Use a constant-time comparison here.',
};

const diffContext: DiffContext = {
  headSha: 'head',
  baseSha: 'base',
  changedFiles: [
    {
      path: finding.path,
      status: 'modified',
      commentableLines: [{ side: 'RIGHT', line: 4 }],
    },
  ],
  changedSinceLast: [
    {
      path: 'src/new-change.ts',
      status: 'added',
      commentableLines: [{ side: 'RIGHT', line: 1 }],
    },
  ],
  pr: {
    number: 1,
    title: 'Review me',
    body: 'Please review.',
    labels: ['security'],
    author: 'octocat',
  },
};

describe('review tools', () => {
  it('marks all Tribunal tools as read-only', () => {
    const tools = createTribunalReviewTools({ diffContext, guidelines: 'Be kind.' });

    expect(Object.values(tools).every((tool) => tool.readOnlyHint)).toBe(true);
  });

  it('returns changed files, pull request context, guidelines, and optional base files', () => {
    const tools = createTribunalReviewTools({
      diffContext,
      guidelines: 'Be kind.',
      readBaseFile: (path) => (path === 'src/auth.ts' ? 'base contents' : null),
    });

    expect(tools.get_changed_files.execute({})).toEqual({
      changedFiles: diffContext.changedFiles,
      changedSinceLast: diffContext.changedSinceLast,
    });
    expect(tools.get_pr_context.execute({})).toEqual({
      pullRequest: diffContext.pr,
      headSha: diffContext.headSha,
      baseSha: diffContext.baseSha,
    });
    expect(tools.get_review_guidelines.execute({})).toEqual({ guidelines: 'Be kind.' });
    expect(tools.read_base_file.execute({ path: 'src/auth.ts' })).toEqual({
      path: 'src/auth.ts',
      contents: 'base contents',
    });
    expect(tools.read_base_file.execute({ path: 'src/missing.ts' })).toEqual({
      path: 'src/missing.ts',
      contents: null,
    });
  });

  it('defaults changed-since output to an empty list when no previous head exists', () => {
    const diffContextWithoutIncrementalChanges: DiffContext = {
      headSha: diffContext.headSha,
      baseSha: diffContext.baseSha,
      changedFiles: diffContext.changedFiles,
      pr: diffContext.pr,
    };
    const tools = createTribunalReviewTools({
      diffContext: diffContextWithoutIncrementalChanges,
      guidelines: 'Be kind.',
    });

    expect(tools.get_changed_files.execute({})).toEqual({
      changedFiles: diffContext.changedFiles,
      changedSinceLast: [],
    });
  });

  it('records valid findings and rejects invalid findings', () => {
    const tools = createTribunalReviewTools({ diffContext, guidelines: 'Be kind.' });

    expect(tools.record_finding.execute({ finding })).toMatchObject({ ok: true });
    expect(
      tools.record_finding.execute({ finding: { ...finding, path: '../secret.txt' } }),
    ).toMatchObject({
      ok: false,
    });
    expect(tools.record_finding.collectedFindings).toEqual([finding]);
  });
});
