import { describe, expect, it } from 'vitest';
import type { DiffContext } from '@tribunal/review-core/types';
import { enforceReadOnlyToolUse } from './hooks';

const diffContext: DiffContext = {
  headSha: 'head',
  baseSha: 'base',
  changedFiles: [
    {
      path: 'src/auth.ts',
      status: 'modified',
      commentableLines: [{ side: 'RIGHT', line: 4 }],
    },
  ],
  pr: { number: 1, title: 'Review me', body: '', labels: [], author: 'octocat' },
};

describe('read-only hook policy', () => {
  it('allows read-only built-in tools scoped to the repository', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Read',
        input: { file_path: 'src/auth.ts' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });
  });

  it('blocks forbidden tools', () => {
    for (const toolName of ['Write', 'Edit', 'Bash']) {
      expect(
        enforceReadOnlyToolUse({
          toolName,
          input: {},
          repositoryRoot: '/workspace/repository',
          diffContext,
        }),
      ).toMatchObject({ permissionDecision: 'deny' });
    }
  });

  it('blocks path traversal and out-of-repository reads', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Read',
        input: { file_path: '../secret.txt' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'deny' });

    expect(
      enforceReadOnlyToolUse({
        toolName: 'Read',
        input: { file_path: '/etc/passwd' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'deny' });
  });

  it('blocks invalid record_finding calls', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'mcp__tribunal__record_finding',
        input: { finding: { path: '../secret.txt' } },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'deny' });
  });

  it('allows valid record_finding calls and path-like keys used by read-only tools', () => {
    const finding = {
      path: 'src/auth.ts',
      startLine: 4,
      endLine: null,
      side: 'RIGHT',
      severity: 'warning',
      title: 'Review this',
      body: 'This changed line needs review.',
    };

    expect(
      enforceReadOnlyToolUse({
        toolName: 'mcp__tribunal__record_finding',
        input: { finding },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Grep',
        input: { pattern: 'authorize' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Glob',
        input: {},
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });
  });
});
