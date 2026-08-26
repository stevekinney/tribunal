import { describe, expect, test } from 'vitest';
import {
  isAuthorizationGated,
  isUntrustedTriggered,
  jobGrantsWrite,
  jobUsesSecrets,
  loadAllWorkflows,
  loadWorkflow,
  triggerEvents,
  type Workflow,
} from '../scripts/workflow-policy';

/**
 * TRI-28 acceptance criterion 5: every workflow using `pull_request_target`
 * (or another untrusted-content trigger) must be covered by this
 * authorization test. Rather than hardcoding a workflow-file allowlist (the
 * donor Protokit checkout's approach, tied to workflows Tribunal does not
 * have — `claude.yml`, `claude-code-review.yml`), this sweeps every
 * workflow actually present under `.github/workflows/` and asserts the
 * invariant generically: a privileged job on an untrusted trigger is either
 * gated behind a read-only, secret-free authorization job, or the test
 * fails and names it.
 *
 * As of writing, `grep -rn "pull_request_target" .github/workflows/`
 * returns no matches, so this currently holds vacuously across all three
 * Tribunal workflows (`ci.yml`, `deploy-production.yml`,
 * `neon-pull-request-branches.yml`) — see the pull request body for the
 * full survey. This test exists to catch the first workflow that
 * introduces `pull_request_target` (or another untrusted trigger) without
 * an authorization gate.
 */
describe('every workflow: untrusted-content triggers cannot reach privileged jobs ungated', () => {
  for (const { fileName, workflow } of loadAllWorkflows()) {
    test(`${fileName}: privileged jobs on untrusted triggers are authorization-gated`, () => {
      if (!isUntrustedTriggered(workflow)) {
        // Nothing to check: this workflow never runs with base-repo
        // secrets against attacker-controlled content.
        return;
      }

      const ungated = Object.entries(workflow.jobs).filter(([jobName, job]) => {
        const privileged = jobGrantsWrite(job) || jobUsesSecrets(job);
        return privileged && !isAuthorizationGated(workflow, jobName);
      });

      expect(
        ungated.map(([jobName]) => jobName),
        `${fileName} triggers on ${triggerEvents(workflow).join(', ')}; every privileged job must be gated by needs: <authorize-job>.outputs.<x> == 'true'`,
      ).toEqual([]);
    });
  }
});

describe('every workflow: least-privilege scaffolding', () => {
  test('every workflow declares an explicit top-level `permissions:` block', () => {
    for (const { fileName, workflow } of loadAllWorkflows()) {
      expect(workflow.permissions, `${fileName} permissions`).toBeDefined();
    }
  });
});

/**
 * Regression test: `audit:workflows`, `test:workflow-authorization`,
 * `test:workflow-prompt-injection`, and `test:production-migration-gate`
 * are root-level `bun run` commands (root `.github/tests` is not a
 * Turborepo workspace, so `bun turbo test` never reaches them). Asserted
 * here, rather than only in the workflow YAML, so removing a step from
 * `ci.yml` fails a test instead of silently un-wiring the gate again.
 */
describe('ci.yml: root workflow-security gates are wired into CI', () => {
  const { workflow } = loadWorkflow('ci.yml');

  test('the lint-format job runs every root workflow-security gate', () => {
    const job = workflow.jobs['lint-format'];
    expect(job).toBeDefined();
    const runCommands = (job.steps ?? []).map((step) => step.run ?? '').join('\n');

    for (const command of [
      'bun run audit:workflows',
      'bun run test:workflow-authorization',
      'bun run test:workflow-prompt-injection',
      'bun run test:production-migration-gate',
    ]) {
      expect(runCommands, `expected "${command}" to run in ci.yml's lint-format job`).toContain(
        command,
      );
    }
  });
});

/**
 * Inline-fixture regressions for `isAuthorizationGated`, independent of
 * which real workflow files exist. These pin the exact bypasses the check
 * must reject: a negated comparison, a job outside its own `needs:` chain,
 * a bare reference with no equality check, and disjunctive gates with an
 * alternate truth path.
 */
function privilegedJob(
  overrides: Partial<Workflow['jobs'][string]> = {},
): Workflow['jobs'][string] {
  return {
    permissions: { contents: 'write' },
    'timeout-minutes': 5,
    ...overrides,
  };
}

function readOnlyJob(): Workflow['jobs'][string] {
  return { permissions: { contents: 'read' }, 'timeout-minutes': 5 };
}

describe('isAuthorizationGated: requires a positive condition naming an actual needs: dependency', () => {
  test('accepts the correct form: needs an authorize job and checks its output equals true', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(true);
  });

  test('rejects a negated condition that runs precisely for a rejected actor', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized != 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('rejects a condition naming a job outside its own needs: chain', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        not_authorized: privilegedJob(),
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.not_authorized.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('rejects a condition that merely references an authorization output with no equality check', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        privileged: privilegedJob({
          needs: 'authorize',
          if: 'needs.authorize.outputs.authorized',
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test("rejects `== 'true' || always()`", () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true' || always()",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('rejects a bare `always()`', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        privileged: privilegedJob({ needs: 'authorize', if: 'always()' }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('the upstream authorize job must itself hold no write permissions or secrets', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: privilegedJob(), // holds write permissions itself: not a real gate
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('still accepts the plain correct form with incidental surrounding whitespace', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: readOnlyJob(),
        privileged: privilegedJob({
          needs: 'authorize',
          if: "  needs.authorize.outputs.authorized == 'true'  ",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(true);
  });
});

/**
 * Regression test: `jobUsesSecrets()` must also detect a secret exposed
 * only through the job-level `env:` block, not only `job.secrets` or
 * step-level `with`/`env`/`run`. A job that leaks a secret only through
 * job-level `env:` would otherwise be misclassified as unprivileged and
 * pass `isAuthorizationGated()` checks without ever needing a gate.
 */
describe('jobUsesSecrets: job-level env detection', () => {
  test('detects a secret referenced only in the job-level `env:` block', () => {
    expect(
      jobUsesSecrets({
        env: { DATABASE_URL: '${{ secrets.DATABASE_URL }}' },
        steps: [{ run: 'echo hello' }],
      }),
    ).toBe(true);
  });

  test('does not flag a job with no secrets anywhere', () => {
    expect(
      jobUsesSecrets({
        env: { NODE_ENV: 'production' },
        steps: [{ run: 'echo hello' }],
      }),
    ).toBe(false);
  });
});
