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

  it('allows Tribunal read-only MCP tools without path input', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'mcp__tribunal__get_changed_files',
        input: {},
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });
  });

  it('allows base-file reads for changed files only', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'mcp__tribunal__read_base_file',
        input: { path: 'src/auth.ts' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });
  });

  it('allows read-only discovery tools without treating grep text as a path', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Grep',
        input: { pattern: '../secret', path: 'src' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });

    expect(
      enforceReadOnlyToolUse({
        toolName: 'Glob',
        input: { pattern: 'src/**/*.ts' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'allow' });

    expect(
      enforceReadOnlyToolUse({
        toolName: 'Glob',
        input: { pattern: '../**/*' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({ permissionDecision: 'deny' });
  });

  it('blocks Glob patterns that escape or cannot be validated as repository-relative', () => {
    for (const pattern of [
      '',
      'src\\**\\*.ts',
      '/tmp/**/*.ts',
      'C:/secrets/**/*.ts',
      '{../secret,src}/**',
      'src/!(safe).ts',
    ]) {
      expect(
        enforceReadOnlyToolUse({
          toolName: 'Glob',
          input: { pattern },
          repositoryRoot: '/workspace/repository',
          diffContext,
        }),
      ).toMatchObject({
        permissionDecision: 'deny',
        reason: 'tool path escapes the repository',
      });
    }
  });

  it('blocks Glob without a string pattern', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Glob',
        input: { pattern: null },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({
      permissionDecision: 'deny',
      reason: 'tool path escapes the repository',
    });
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

  it('blocks direct reads outside the pull request diff', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'Read',
        input: { file_path: 'src/unchanged.ts' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({
      permissionDecision: 'deny',
      reason: 'read path is outside the pull request diff',
    });

    expect(
      enforceReadOnlyToolUse({
        toolName: 'mcp__tribunal__read_base_file',
        input: { path: 'src/unchanged.ts' },
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({
      permissionDecision: 'deny',
      reason: 'read path is outside the pull request diff',
    });
  });

  it('requires scoped read tools to provide a path', () => {
    expect(
      enforceReadOnlyToolUse({
        toolName: 'mcp__tribunal__read_base_file',
        input: {},
        repositoryRoot: '/workspace/repository',
        diffContext,
      }),
    ).toMatchObject({
      permissionDecision: 'deny',
      reason: 'read path is required',
    });
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

  it('allows valid record_finding calls', () => {
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
  });
});
