import { describe, expect, it } from 'vitest';
import { agentResultSchema, agentSpecSchema, findingSchema } from './schemas';

describe('review-core schemas', () => {
  it('accepts a valid agent spec', () => {
    expect(
      agentSpecSchema.parse({
        id: 'agent_1',
        userId: 1,
        slug: 'security-reviewer',
        description: 'Find security issues',
        body: 'Review the changed files.',
        model: 'inherit',
        effort: 'high',
        enabled: true,
      }),
    ).toMatchObject({ slug: 'security-reviewer' });
  });

  it('rejects an invalid effort', () => {
    expect(() =>
      agentSpecSchema.parse({
        id: 'agent_1',
        userId: 1,
        slug: 'security-reviewer',
        description: 'Find security issues',
        body: 'Review the changed files.',
        model: 'inherit',
        effort: 'extreme',
        enabled: true,
      }),
    ).toThrow();
  });

  it('rejects an invalid finding severity and missing path', () => {
    expect(() =>
      findingSchema.parse({
        startLine: 12,
        endLine: 12,
        side: 'RIGHT',
        severity: 'critical',
        title: 'Unsafe input',
        body: 'The input is not validated.',
      }),
    ).toThrow();
  });

  it('rejects a malformed agent result', () => {
    expect(() =>
      agentResultSchema.parse({
        agentSlug: 'security-reviewer',
        findings: [],
        modelUsed: 'claude-sonnet-4-6',
        effortUsed: 'high',
        usage: { inputTokens: 1 },
        costEstimateUsd: 0.02,
        durationMs: 1200,
      }),
    ).toThrow();
  });
});
