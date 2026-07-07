import { describe, expect, it } from 'vitest';
import type { DiffContext, Finding } from '@tribunal/review-core/types';
import { buildReviewPrompt, buildTriagePrompt, buildVerificationPrompt } from './prompts';

const diffContext: DiffContext = {
  headSha: 'head-sha',
  baseSha: 'base-sha',
  changedFiles: [
    {
      path: 'src/auth.ts',
      status: 'modified',
      patch: '@@ -10,2 +10,2 @@\n-old\n+new',
      commentableLines: [{ side: 'RIGHT', line: 11 }],
    },
  ],
  pr: {
    number: 42,
    title: 'Review engine foundation',
    body: 'Pull request body',
    labels: ['review-engine'],
    author: 'steve',
  },
};

describe('buildReviewPrompt', () => {
  it('shares a byte-identical prefix across agents so the SDK prompt cache is reused', () => {
    const guidelines = 'Prefer concrete evidence.';

    const correctnessPrompt = buildReviewPrompt({
      agentDescription: 'Correctness reviewer',
      agentBody: 'Focus on logic errors.',
      diffContext,
      guidelines,
    });
    const securityPrompt = buildReviewPrompt({
      agentDescription: 'Security reviewer',
      agentBody: 'Focus on auth and injection flaws.',
      diffContext,
      guidelines,
    });

    const sharedPrefixLength = commonPrefixLength(correctnessPrompt, securityPrompt);
    const agentRoleIndex = correctnessPrompt.indexOf('Agent role');
    const agentDescriptionIndex = correctnessPrompt.indexOf('Correctness reviewer');

    expect(agentRoleIndex).toBeGreaterThan(0);
    // Everything up to (and including) the "Agent role" heading is shared;
    // the prefix only diverges once the per-agent description text begins.
    expect(sharedPrefixLength).toBe(agentDescriptionIndex);
    expect(correctnessPrompt.slice(0, sharedPrefixLength)).toBe(
      securityPrompt.slice(0, sharedPrefixLength),
    );
  });

  it('varies only the agent role and instructions section between agents', () => {
    const guidelines = 'Prefer concrete evidence.';
    const prompt = buildReviewPrompt({
      agentDescription: 'Correctness reviewer',
      agentBody: 'Focus on logic errors.',
      diffContext,
      guidelines,
    });

    expect(prompt.indexOf('Agent role')).toBeLessThan(prompt.indexOf('Agent instructions'));
    expect(prompt).toContain('Correctness reviewer');
    expect(prompt).toContain('Focus on logic errors.');
  });
});

describe('buildTriagePrompt', () => {
  it('lists available specialists and asks for a skip decision and risk flags', () => {
    const prompt = buildTriagePrompt({
      diffContext,
      guidelines: 'Prefer concrete evidence.',
      availableAgentSlugs: ['correctness-review', 'security-review'],
    });

    expect(prompt).toContain('correctness-review, security-review');
    expect(prompt).toContain('skip: true');
    expect(prompt).toContain('riskFlags');
    expect(prompt).toContain('Pull request diff');
  });

  it('reports no specialists configured when the roster is empty', () => {
    const prompt = buildTriagePrompt({
      diffContext,
      guidelines: 'Prefer concrete evidence.',
      availableAgentSlugs: [],
    });

    expect(prompt).toContain('(none configured)');
  });
});

describe('buildVerificationPrompt', () => {
  const finding: Finding = {
    path: 'src/auth.ts',
    startLine: 11,
    endLine: null,
    side: 'RIGHT',
    severity: 'error',
    title: 'Missing auth check',
    body: 'The handler never verifies the caller is authorized.',
  };

  it('cites the candidate finding location and asks for a concrete refutation', () => {
    const prompt = buildVerificationPrompt({ diffContext, finding });

    expect(prompt).toContain('Path: src/auth.ts');
    expect(prompt).toContain('Line: 11');
    expect(prompt).toContain('Missing auth check');
    expect(prompt).toContain('verified: true');
    expect(prompt).toContain('Pull request diff');
  });

  it('reports file-level findings without a line number', () => {
    const prompt = buildVerificationPrompt({
      diffContext,
      finding: { ...finding, startLine: null, endLine: null },
    });

    expect(prompt).toContain('Line: (file-level)');
  });
});

function commonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) index += 1;
  return index;
}
