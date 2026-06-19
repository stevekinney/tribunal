import { expect, test } from '@playwright/test';
import { enforceReadOnlyToolUse } from '@tribunal/agents';
import type { DiffContext } from '@tribunal/review-core';
import { createE2ESession, e2eHeaders } from '../helpers';

const diffContext: DiffContext = {
  repository: { owner: 'lostgradient', name: 'tribunal' },
  pr: { number: 15, title: 'Security harness', author: 'octocat' },
  baseSha: 'base',
  headSha: 'head',
  changedFiles: [{ path: 'src/security.ts', status: 'modified', additions: 1, deletions: 1 }],
};

test('prompt injection cannot enable mutating tools', () => {
  const decision = enforceReadOnlyToolUse({
    toolName: 'Bash',
    input: { command: 'printf token && git push' },
    repositoryRoot: '/workspace/repository',
    diffContext,
  });

  expect(decision).toEqual({
    permissionDecision: 'deny',
    reason: 'tool is not in the Tribunal review allowlist',
  });
});

test('egress-like file reads are constrained to changed repository files', () => {
  const decision = enforceReadOnlyToolUse({
    toolName: 'Read',
    input: { file_path: '../secrets.env' },
    repositoryRoot: '/workspace/repository',
    diffContext,
  });

  expect(decision).toEqual({
    permissionDecision: 'deny',
    reason: 'tool path escapes the repository',
  });
});

test('credentials are absent from the fake-backed E2E harness responses', async ({
  page,
  request,
}, testInfo) => {
  const session = await createE2ESession(page, request, testInfo);
  const response = await request.post('/__e2e__/review-lifecycle', {
    headers: e2eHeaders(session.workerId),
    data: {
      userId: session.user.id,
      repositoryId: session.repository.id,
      kind: 'opened',
      headSha: 'credential-check',
      deliveryId: 'credential-check',
    },
  });

  expect(response.ok()).toBe(true);
  const body = JSON.stringify(await response.json());
  expect(body).not.toContain('sk-');
  expect(body).not.toContain('ghp_');
  expect(body).not.toContain('TRIBUNAL_RUN_TOKEN');
});

test('redaction expectations reject leaked secret-shaped output', () => {
  const rendered = JSON.stringify({
    finding: {
      body: 'The reviewer saw [REDACTED] rather than the original credential.',
    },
  });

  expect(rendered).toContain('[REDACTED]');
  expect(rendered).not.toMatch(/sk-ant-[A-Za-z0-9_-]+/);
  expect(rendered).not.toMatch(/gh[pousr]_[A-Za-z0-9_]+/);
});

test('read-only token enforcement denies findings outside the pull request diff', () => {
  const decision = enforceReadOnlyToolUse({
    toolName: 'mcp__tribunal__record_finding',
    input: {
      finding: {
        path: 'src/not-in-diff.ts',
        startLine: 1,
        endLine: 1,
        side: 'RIGHT',
        severity: 'warning',
        title: 'Out of scope',
        body: 'This should not be accepted.',
      },
    },
    repositoryRoot: '/workspace/repository',
    diffContext,
  });

  expect(decision.permissionDecision).toBe('deny');
});
