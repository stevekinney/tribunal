import { describe, expect, test } from 'vitest';
import {
  ciWiringViolations,
  runLinesExecute,
  shellCommandLines,
  isAuthorizationGated,
  jobGrantsWrite,
  jobUsesSecrets,
  loadAllWorkflows,
  triggerEvents,
  untrustedPrivilegedUngatedJobs,
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
 * gated behind a read-only, secret-free authorization job, exempted by a
 * narrow, documented exception, or the test fails and names it.
 *
 * TRI-28 B1/B13: this NO LONGER holds vacuously. `workflow_run` joined
 * `UNTRUSTED_EVENTS`, and `deploy-production.yml` triggers on it, so its
 * `deploy` job (which references secrets directly) is a genuine,
 * non-vacuous subject of this sweep. It passes not because nothing needs
 * checking, but because it carries a narrow, documented exemption (see
 * `UNTRUSTED_TRIGGER_EXEMPTIONS` in `workflow-policy.ts`) backed by
 * `production-migration-gate.test.ts`'s structural validation of its `if:`
 * shape. `ci.yml` and `neon-pull-request-branches.yml` remain vacuous (no
 * privileged job on any untrusted trigger). This test exists to catch the
 * next workflow that introduces an untrusted trigger without either an
 * authorization gate or an exemption.
 */
describe('every workflow: untrusted-content triggers cannot reach privileged jobs ungated', () => {
  for (const { fileName, workflow } of loadAllWorkflows()) {
    test(`${fileName}: privileged jobs on untrusted triggers are authorization-gated`, () => {
      const ungated = untrustedPrivilegedUngatedJobs(fileName, workflow);

      expect(
        ungated,
        `${fileName} triggers on ${triggerEvents(workflow).join(', ')}; every privileged job must be gated by needs: <authorize-job>.outputs.<x> == 'true', or carry a narrow documented exemption`,
      ).toEqual([]);
    });
  }
});

/**
 * TRI-28 B1: the `(deploy-production.yml, deploy)` exemption in
 * `workflow-policy.ts` must be narrow -- keyed on the exact file AND job
 * name, not on shape alone. A different file or a different job with the
 * identical privileged-on-untrusted-trigger shape must still be flagged.
 */
describe('untrustedPrivilegedUngatedJobs: the untrusted-trigger exemption is narrow', () => {
  test('the same job name in a different file is NOT exempt', () => {
    const workflow: Workflow = {
      on: { workflow_run: { workflows: ['CI'] } },
      permissions: { contents: 'read' },
      jobs: { deploy: { env: { TOKEN: '${{ secrets.SOMETHING }}' } } },
    };
    expect(untrustedPrivilegedUngatedJobs('a-different-workflow.yml', workflow)).toEqual([
      'deploy',
    ]);
  });

  test('a different job name in deploy-production.yml is NOT exempt', () => {
    const workflow: Workflow = {
      on: { workflow_run: { workflows: ['CI'] } },
      permissions: { contents: 'read' },
      jobs: { 'some-other-job': { env: { TOKEN: '${{ secrets.SOMETHING }}' } } },
    };
    expect(untrustedPrivilegedUngatedJobs('deploy-production.yml', workflow)).toEqual([
      'some-other-job',
    ]);
  });
});

describe('every workflow: least-privilege scaffolding', () => {
  test('every workflow declares an explicit top-level `permissions:` block', () => {
    for (const { fileName, workflow } of loadAllWorkflows()) {
      expect(workflow.permissions, `${fileName} permissions`).toBeDefined();
    }
  });
});

/**
 * TRI-28 B11: `ciWiringViolations` (the invariant that all four root
 * workflow-security commands stay wired into ci.yml) now lives in
 * `workflow-policy.ts` and runs as part of `audit:workflows` itself,
 * precisely so it does not stop enforcing if THIS suite's own step is
 * removed from `ci.yml`. This is ordinary unit coverage of that function's
 * correctness against the real file -- not the enforcement mechanism.
 */
describe('ciWiringViolations: the real ci.yml has every root security gate wired in', () => {
  test('reports no violations against the real ci.yml', () => {
    expect(ciWiringViolations()).toEqual([]);
  });
});

/**
 * The wiring rule itself, against fixtures rather than the real file.
 *
 * `ciWiringViolations` reads `ci.yml` and takes no injectable workflow, so the
 * shapes that bypass it can only be pinned by testing the rule directly. Both
 * of these were real bypasses: a suffix that neutralises the exit status, and
 * the same suffix hidden behind a shell line continuation, which a
 * per-physical-line check reads as a bare command with a trailing backslash.
 */
describe('the CI wiring rule rejects what the shell would neutralise', () => {
  const COMMAND = 'bun run validate:test-runner-imports';

  test('accepts the command standing alone, or with gating arguments', () => {
    expect(runLinesExecute(shellCommandLines(COMMAND), COMMAND)).toBe(true);
    expect(runLinesExecute(shellCommandLines(`${COMMAND} --strict`), COMMAND)).toBe(true);
  });

  test('rejects a suffix that can change the exit status', () => {
    for (const suffix of ['|| true', '; true', '| cat', '& disown', '&& echo ok', '> /dev/null']) {
      const line = `${COMMAND} ${suffix}`;
      expect(runLinesExecute(shellCommandLines(line), COMMAND), line).toBe(false);
    }
  });

  test('joins a continuation before judging it, as bash does', () => {
    // The physical first line *is* the command plus a backslash, so a
    // per-line check found nothing objectionable while bash ran the joined,
    // neutralised command.
    expect(runLinesExecute(shellCommandLines(`${COMMAND} \\\n  || true`), COMMAND)).toBe(false);
    expect(runLinesExecute(shellCommandLines(`${COMMAND} \\\n  --strict`), COMMAND)).toBe(true);
    // A trailing backslash continuing into nothing still runs the command.
    expect(runLinesExecute(shellCommandLines(`${COMMAND} \\\n`), COMMAND)).toBe(true);
  });
});

/**
 * Inline-fixture regressions for `isAuthorizationGated`, independent of
 * which real workflow files exist. These pin the exact bypasses the check
 * must reject: a negated comparison, a job outside its own `needs:` chain,
 * a bare reference with no equality check, disjunctive gates with an
 * alternate truth path, and (TRI-28 B7) a cosmetic gate that satisfies
 * every structural check while authorizing everybody or nobody.
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

// A real authorize job: read-only, no secrets, and its output is actually
// derived from `author_association` -- a concrete GitHub-provided trust
// signal, not a value the job invents or an attacker supplies.
function readOnlyJob(): Workflow['jobs'][string] {
  return {
    permissions: { contents: 'read' },
    'timeout-minutes': 5,
    steps: [
      {
        run: 'echo "authorized=${{ contains(fromJson(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association) }}" >> "$GITHUB_OUTPUT"',
      },
    ],
  };
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
 * TRI-28 B7: a job whose `if:` structurally matches
 * `needs.<job>.outputs.<x> == 'true'`, against an upstream job that holds
 * no write permissions and no secrets, still is not authorization-gated
 * unless that upstream job implements a recognizable authorization check.
 */
describe('isAuthorizationGated: rejects a cosmetic gate (TRI-28 B7)', () => {
  test('rejects an authorize job that writes a hardcoded `true` output with no check at all', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [{ run: 'echo "authorized=true" >> "$GITHUB_OUTPUT"' }],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('rejects an authorize job whose output is derived from attacker-controlled event text', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [
            {
              run: 'echo "authorized=${{ contains(github.event.issue.title, \'approved\') }}" >> "$GITHUB_OUTPUT"',
            },
          ],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('accepts an authorize job that compares `github.actor` against an allowlist with `contains()`', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [
            {
              run: 'echo "authorized=${{ contains(fromJson(\'[\\"alice\\",\\"bob\\"]\'), github.actor) }}" >> "$GITHUB_OUTPUT"',
            },
          ],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(true);
  });

  test('rejects an authorize job that mentions author_association elsewhere but hardcodes its output (TRI-28 C1)', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [
            {
              // Mentions `author_association`, but this step does not SET
              // the "authorized" output at all -- it only logs it.
              run: 'echo "commenter association: ${{ github.event.comment.author_association }}"',
            },
            {
              // The step that actually sets "authorized" hardcodes it, with
              // no derivation from the predicate mentioned above.
              run: 'echo "authorized=true" >> "$GITHUB_OUTPUT"',
            },
          ],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('rejects a predicate-derived assignment paired with a heredoc override of the same output (TRI-28 C1)', () => {
    // The sibling test above covers two `echo NAME=value` assignments. This
    // one covers the same attack expressed through the heredoc idiom, which
    // is the form the assignment decoder deliberately does not parse -- and
    // which, under $GITHUB_OUTPUT's last-write-wins semantics, is the write
    // that actually takes effect at runtime.
    //
    // Found independently by two reviewers on #319: a genuine
    // predicate-derived assignment plus a hardcoded heredoc override of the
    // same name read as properly gated, because the heredoc write was
    // invisible to the "exactly one assignment" counter.
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [
            {
              run: 'echo "authorized=${{ contains(fromJson(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association) }}" >> "$GITHUB_OUTPUT"',
            },
            {
              // Hardcoded override via heredoc. Wins at runtime.
              run: [
                '{',
                "  echo 'authorized<<EOF'",
                "  echo 'true'",
                "  echo 'EOF'",
                '} >> "$GITHUB_OUTPUT"',
              ].join('\n'),
            },
          ],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('still accepts a single predicate-derived assignment with no second write (TRI-28 C1)', () => {
    // The counter must reject extra writes without rejecting the legitimate
    // single-assignment shape it is meant to permit.
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [
            {
              run: 'echo "authorized=${{ contains(fromJson(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association) }}" >> "$GITHUB_OUTPUT"',
            },
          ],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(true);
  });

  test('rejects an authorize job that assigns the compared output twice, the second hardcoded (TRI-28 C1)', () => {
    // $GITHUB_OUTPUT is a plain `name=value` file that is last-write-wins at
    // runtime: a real, predicate-derived assignment followed by a second,
    // hardcoded assignment of the same output name would authorize every
    // commenter at runtime while a check that only looked for "is there SOME
    // predicate-derived assignment" would accept it.
    const workflow: Workflow = {
      jobs: {
        authorize: {
          permissions: { contents: 'read' },
          'timeout-minutes': 5,
          steps: [
            {
              run: 'echo "authorized=${{ contains(fromJson(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association) }}" >> "$GITHUB_OUTPUT"',
            },
            { run: 'echo "authorized=true" >> "$GITHUB_OUTPUT"' },
          ],
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(false);
  });

  test('accepts delegation to a standardized reusable authorization workflow via `uses:`', () => {
    const workflow: Workflow = {
      jobs: {
        authorize: {
          uses: './.github/workflows/authorize.yml',
          permissions: { contents: 'read' },
        },
        privileged: privilegedJob({
          needs: 'authorize',
          if: "needs.authorize.outputs.authorized == 'true'",
        }),
      },
    };
    expect(isAuthorizationGated(workflow, 'privileged')).toBe(true);
  });
});

/**
 * TRI-28 B2: `jobGrantsWrite` must compute the EFFECTIVE permissions of a
 * job (`job.permissions ?? workflow.permissions`), not just its own
 * job-level block. A job with no job-level `permissions:` inherits the
 * workflow-level grant; previously this was invisible to the audit.
 */
describe('jobGrantsWrite: inherits workflow-level permissions (TRI-28 B2)', () => {
  test('a job with no job-level permissions inherits a privileged workflow-level grant', () => {
    const workflow: Workflow = {
      permissions: { contents: 'write' },
      jobs: { act: {} },
    };
    expect(jobGrantsWrite(workflow.jobs.act, workflow)).toBe(true);
  });

  test('a job-level permissions block overrides, rather than merges with, the workflow-level grant', () => {
    const workflow: Workflow = {
      permissions: { contents: 'write' },
      jobs: { act: { permissions: { contents: 'read' } } },
    };
    expect(jobGrantsWrite(workflow.jobs.act, workflow)).toBe(false);
  });

  test('no permissions anywhere (job or workflow) is not a write grant', () => {
    const workflow: Workflow = { jobs: { act: {} } };
    expect(jobGrantsWrite(workflow.jobs.act, workflow)).toBe(false);
  });

  test('end-to-end: an untrusted-triggered job with only an inherited write grant and no secrets is flagged', () => {
    // The exact false-negative construct from TRI-28 B2: on: issue_comment,
    // a privileged top-level `permissions:`, and a job with no job-level
    // permissions block and no literal `secrets.*` reference.
    const workflow: Workflow = {
      on: 'issue_comment',
      permissions: { contents: 'write' },
      jobs: { act: {} },
    };
    expect(untrustedPrivilegedUngatedJobs('fixture-b2.yml', workflow)).toEqual(['act']);
  });
});

/**
 * TRI-28 B3: `jobUsesSecrets()` must detect a secret exposed through
 * bracket-form access (`secrets['NAME']`), the ambient `github.token`, and
 * a workflow-level `env:` block — not only `job.secrets`, dot-form
 * `secrets.NAME`, or job/step-level `with`/`env`/`run`.
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

describe('jobUsesSecrets: bracket-form access, github.token, and workflow-level env (TRI-28 B3)', () => {
  test('detects bracket-form secret access: `secrets["DEPLOY_TOKEN"]`', () => {
    expect(
      jobUsesSecrets({
        steps: [{ run: 'echo "${{ secrets[\'DEPLOY_TOKEN\'] }}"' }],
      }),
    ).toBe(true);
  });

  test('detects the ambient `github.token`', () => {
    expect(
      jobUsesSecrets({
        steps: [{ env: { GH_TOKEN: '${{ github.token }}' }, run: 'gh api /repos' }],
      }),
    ).toBe(true);
  });

  test('detects a secret named only in the workflow-level `env:` block, not the job', () => {
    const workflow: Workflow = {
      env: { TURBO_TOKEN: '${{ secrets.TURBO_TOKEN }}' },
      jobs: { build: { steps: [{ run: 'bunx turbo build' }] } },
    };
    expect(jobUsesSecrets(workflow.jobs.build, workflow)).toBe(true);
  });

  test('does not flag a job with no secrets anywhere, including no workflow-level env secret', () => {
    const workflow: Workflow = {
      env: { NODE_ENV: 'production' },
      jobs: { build: { steps: [{ run: 'bunx turbo build' }] } },
    };
    expect(jobUsesSecrets(workflow.jobs.build, workflow)).toBe(false);
  });
});

/**
 * TRI-28 C3: `jobUsesSecrets` previously never inspected `container.env`,
 * `container.credentials`, or any `services.*` field, so a job whose only
 * secret exposure was through its container or a service container
 * classified as unprivileged.
 */
describe('jobUsesSecrets: container and service fields (TRI-28 C3)', () => {
  test('detects a secret referenced only in `container.env`', () => {
    expect(
      jobUsesSecrets({
        container: { image: 'node:20', env: { TOKEN: '${{ secrets.REGISTRY_TOKEN }}' } },
        steps: [{ run: 'echo hello' }],
      }),
    ).toBe(true);
  });

  test('detects a secret referenced only in `container.credentials`', () => {
    expect(
      jobUsesSecrets({
        container: {
          image: 'ghcr.io/example/private:latest',
          credentials: {
            username: 'example',
            password: '${{ secrets.REGISTRY_PASSWORD }}',
          },
        },
        steps: [{ run: 'echo hello' }],
      }),
    ).toBe(true);
  });

  test('detects a secret referenced only in a `services.*` entry', () => {
    expect(
      jobUsesSecrets({
        services: {
          postgres: {
            image: 'postgres:16',
            env: { POSTGRES_PASSWORD: '${{ secrets.DATABASE_PASSWORD }}' },
          },
        },
        steps: [{ run: 'echo hello' }],
      }),
    ).toBe(true);
  });

  test('does not flag a container/services job with no secrets anywhere', () => {
    expect(
      jobUsesSecrets({
        container: { image: 'node:20' },
        services: { postgres: { image: 'postgres:16', env: { POSTGRES_PASSWORD: 'local-only' } } },
        steps: [{ run: 'echo hello' }],
      }),
    ).toBe(false);
  });

  test('end-to-end: an issue_comment job with read-only permissions and a container secret is flagged ungated', () => {
    // The exact false-negative construct from TRI-28 C3: on: issue_comment,
    // read-only job permissions, and the only secret exposure sitting in
    // `container.env` -- previously invisible to `jobUsesSecrets`, so the
    // job classified as unprivileged and ran ungated.
    const workflow: Workflow = {
      on: 'issue_comment',
      permissions: { contents: 'read' },
      jobs: {
        act: {
          container: { image: 'node:20', env: { TOKEN: '${{ secrets.REGISTRY_TOKEN }}' } },
          steps: [{ run: 'echo hello' }],
        },
      },
    };
    expect(untrustedPrivilegedUngatedJobs('fixture-c3.yml', workflow)).toEqual(['act']);
  });
});
