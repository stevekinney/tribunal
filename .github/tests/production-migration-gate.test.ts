import { describe, expect, test } from 'vitest';
import { loadWorkflow } from '../scripts/workflow-policy';

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

  test('runs are serialized with a concurrency group that never cancels an in-flight migration', () => {
    const concurrency = workflow.concurrency as {
      group?: string;
      'cancel-in-progress'?: boolean;
    };
    expect(concurrency).toBeDefined();
    expect(concurrency.group).toBeTruthy();
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

  test('the deploy job only runs for a successful CI run on main, or an explicit main-branch dispatch', () => {
    const condition = deploy.if ?? '';
    expect(condition).toMatch(/github\.event_name == 'workflow_dispatch'/);
    expect(condition).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(condition).toMatch(/github\.event_name == 'workflow_run'/);
    expect(condition).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    expect(condition).toMatch(/github\.event\.workflow_run\.head_branch == 'main'/);
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

  test('migrations run against a secret-sourced database URL, never a hardcoded connection string', () => {
    const steps = deploy.steps ?? [];
    const migrateStep = steps.find((step) => step.run === 'bun run db:migrate');
    expect(migrateStep).toBeDefined();
    expect(migrateStep?.env?.DATABASE_URL).toBe('${{ secrets.MIGRATION_DATABASE_URL }}');
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
      expect(scaleIndex, `${service} scale step`).toBeGreaterThan(deployIndex);
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
