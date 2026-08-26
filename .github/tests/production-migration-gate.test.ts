import { describe, expect, test } from 'vitest';
import { loadWorkflow, splitConditionIntoOrBranches } from '../scripts/workflow-policy';

/**
 * Structural invariants for `deploy-production.yml`'s production migration
 * gate. Tribunal runs migration and deploy in a single `deploy` job (not
 * the donor Protokit checkout's separate `migrate` + `deploy` jobs behind a
 * shared `environment: production`), so these assertions are written
 * against Tribunal's actual shape rather than ported verbatim.
 */
describe('deploy-production.yml: production migration gate', () => {
  const { workflow } = loadWorkflow('deploy-production.yml');
  const deploy = workflow.jobs.deploy;

  test('the deploy job exists', () => {
    expect(deploy).toBeDefined();
  });

  /**
   * TRI-28 C7: the previous version only checked `concurrency.group` was
   * truthy. Changing it to a per-run value like
   * `production-${{ github.run_id }}` keeps that check passing -- the group
   * is still a non-empty string and cancellation is still disabled -- while
   * every run gets its own, distinct concurrency group, so production runs
   * stop being serialized at all: concurrent migrations and interleaved
   * service deploys against the same environment become possible. This
   * asserts the known stable group value, not merely that some value is
   * present.
   */
  test('runs are serialized with a concurrency group that never cancels an in-flight migration', () => {
    const concurrency = workflow.concurrency as {
      group?: string;
      'cancel-in-progress'?: boolean;
    };
    expect(concurrency).toBeDefined();
    expect(concurrency.group).toBe('production-deploy');
    expect(concurrency['cancel-in-progress']).toBe(false);
  });

  test('the deploy job runs behind a protected GitHub environment', () => {
    expect(deploy.environment).toBe('production');
  });

  test('the deploy job cannot run via an unconditional override: no `always()` in its `if`', () => {
    // GitHub Actions skips a job whose `if` evaluates false; an `always()`
    // anywhere in the condition would let the job run even when the
    // upstream CI run failed or came from a non-main branch, defeating the
    // trigger restriction below.
    expect(deploy.if ?? '').not.toMatch(/always\(\)/);
  });

  /**
   * TRI-28 B8: the previous version of this test checked five independent
   * substrings with `toMatch`. Prepending `github.actor == 'someone' ||` to
   * the real condition keeps all five matching (every substring is still
   * present somewhere in the string) while allowing deploys triggered by
   * that actor regardless of CI success or branch -- a genuine
   * authorization bypass the old test could not see. This instead parses
   * the condition into its top-level `||` branches (each a SET of `&&`
   * clauses) via `splitConditionIntoOrBranches` and requires the result to
   * be EXACTLY the two recognized branches, no more and no fewer -- so an
   * extra disjunct changes the branch count and fails the `toHaveLength`
   * check before the individual branch checks even run.
   */
  test('the deploy job only runs for a successful CI run on main, or an explicit main-branch dispatch', () => {
    const branches = splitConditionIntoOrBranches(deploy.if ?? '');

    const dispatchOnMainBranch = new Set([
      "github.event_name == 'workflow_dispatch'",
      "github.ref == 'refs/heads/main'",
    ]);
    const successfulMainPushBranch = new Set([
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_branch == 'main'",
    ]);

    expect(branches, 'exactly two top-level || branches, no extra disjunct').toHaveLength(2);
    expect(branches).toContainEqual(dispatchOnMainBranch);
    expect(branches).toContainEqual(successfulMainPushBranch);
  });

  test('the workflow_run checkout path pins to the exact commit that triggered the run, not a re-resolved main', () => {
    const steps = deploy.steps ?? [];
    const workflowRunCheckout = steps.find(
      (step) =>
        step.uses?.startsWith('actions/checkout') &&
        step.if === "github.event_name == 'workflow_run'",
    );
    expect(workflowRunCheckout).toBeDefined();
    expect(workflowRunCheckout?.with?.ref).toBe('${{ github.event.workflow_run.head_sha }}');
  });

  test('a step verifies the deploy commit still matches origin/main before deploying', () => {
    const steps = deploy.steps ?? [];
    const verifyStep = steps.find((step) => step.name === 'Verify deploy commit is current main');
    expect(verifyStep).toBeDefined();
    expect(verifyStep?.run ?? '').toMatch(/origin\/main/);
    expect(verifyStep?.run ?? '').toMatch(/exit 1/);
  });

  /**
   * TRI-28 C6: the previous version of this test inspected only two
   * substrings of the verify step's own script. Moving the step after a
   * Fly deployment or the migration, giving it `continue-on-error: true`,
   * or flipping its `if:` to skip `workflow_run` executions all left those
   * two substring checks passing while defeating the gate -- a queued older
   * successful main run could then migrate and deploy stale code. This
   * asserts the step precedes EVERY Fly deploy step AND the migration step
   * (migrating with a stale, pre-verified commit is exactly as bad as
   * deploying one), and that it retains the exact fail-closed execution
   * controls that make it a real pre-deploy gate rather than merely present
   * text: it must run precisely on `workflow_run` executions (never be
   * flipped to skip them) and must not be allowed to continue past its own
   * failure.
   */
  test('the current-main verification step precedes every deploy step and cannot be skipped or softened', () => {
    const steps = deploy.steps ?? [];
    const verifyIndex = steps.findIndex(
      (step) => step.name === 'Verify deploy commit is current main',
    );
    const migrateIndex = steps.findIndex((step) => step.run === 'bun run db:migrate');
    const flyDeployIndices = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => (step.run ?? '').includes('flyctl deploy'))
      .map(({ index }) => index);

    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(migrateIndex).toBeGreaterThanOrEqual(0);
    expect(flyDeployIndices.length).toBeGreaterThan(0);

    expect(verifyIndex, 'verify step must precede the migration step').toBeLessThan(migrateIndex);
    for (const flyDeployIndex of flyDeployIndices) {
      expect(verifyIndex, 'verify step must precede every Fly deploy step').toBeLessThan(
        flyDeployIndex,
      );
    }

    const verifyStep = steps[verifyIndex];
    expect(
      verifyStep?.if,
      'the verify step must run precisely on workflow_run executions, never be flipped to skip them',
    ).toBe("github.event_name == 'workflow_run'");
    expect(
      verifyStep?.['continue-on-error'],
      'the verify step must remain fail-closed',
    ).toBeUndefined();
  });

  test('migrations run against a secret-sourced database URL, never a hardcoded connection string', () => {
    const steps = deploy.steps ?? [];
    const migrateStep = steps.find((step) => step.run === 'bun run db:migrate');
    expect(migrateStep).toBeDefined();
    expect(migrateStep?.env?.DATABASE_URL).toBe('${{ secrets.MIGRATION_DATABASE_URL }}');
  });

  /**
   * TRI-28 B9: the previous version only checked the migrate step's
   * command and env, so `continue-on-error: true` or a skippable `if:`
   * would let the Fly deploy steps proceed after a FAILED migration
   * without failing the gate. `undefined` is asserted explicitly (rather
   * than `.not.toBe(true)`) because `continue-on-error` accepts a
   * `${{ ... }}` expression string in real YAML, and a boolean-only check
   * would let a truthy expression string slip past.
   */
  test('the migration step is unconditional and cannot continue past its own failure', () => {
    const steps = deploy.steps ?? [];
    const migrateStep = steps.find((step) => step.run === 'bun run db:migrate');
    expect(migrateStep).toBeDefined();
    expect(migrateStep?.if).toBeUndefined();
    expect(migrateStep?.['continue-on-error']).toBeUndefined();
  });

  test('migrations run before any Fly deploy step (deploy-then-migrate cannot happen)', () => {
    const steps = deploy.steps ?? [];
    const migrateIndex = steps.findIndex((step) => step.run === 'bun run db:migrate');
    const firstFlyDeployIndex = steps.findIndex((step) =>
      (step.run ?? '').includes('flyctl deploy'),
    );

    expect(migrateIndex).toBeGreaterThanOrEqual(0);
    expect(firstFlyDeployIndex).toBeGreaterThan(migrateIndex);
  });

  /**
   * TRI-28 B10: `scaleIndex > deployIndex` passes even if the scale step
   * moves arbitrarily far after its deploy step -- including after another
   * service's deploy step -- potentially leaving a drifted multi-machine
   * engine running while a later step's failure aborts the run before its
   * OWN scale step executes. Requiring direct adjacency
   * (`scaleIndex === deployIndex + 1`) is what the description ("scaled to
   * a singleton IMMEDIATELY after its own deploy step") actually claims.
   */
  test('every Fly-managed service is scaled to a singleton immediately after its own deploy step', () => {
    const steps = deploy.steps ?? [];
    for (const service of ['proxy', 'engine', 'web']) {
      const deployIndex = steps.findIndex(
        (step) => step.run === `flyctl deploy . --config deployment/fly/${service}.toml`,
      );
      const scaleIndex = steps.findIndex(
        (step) => step.run === `flyctl scale count 1 --yes --app tribunal-${service}`,
      );
      expect(deployIndex, `${service} deploy step`).toBeGreaterThanOrEqual(0);
      expect(scaleIndex, `${service} scale step must directly follow its deploy step`).toBe(
        deployIndex + 1,
      );
    }
  });

  test('required deployment configuration is validated with a hard failure before anything is deployed', () => {
    const steps = deploy.steps ?? [];
    const validateIndex = steps.findIndex(
      (step) => step.name === 'Validate deployment configuration',
    );
    const firstFlyDeployIndex = steps.findIndex((step) =>
      (step.run ?? '').includes('flyctl deploy'),
    );
    expect(validateIndex).toBeGreaterThanOrEqual(0);
    expect(validateIndex).toBeLessThan(firstFlyDeployIndex);
    expect(steps[validateIndex]?.run ?? '').toMatch(/MIGRATION_DATABASE_URL/);
    expect(steps[validateIndex]?.run ?? '').toMatch(/exit 1/);
  });
});
