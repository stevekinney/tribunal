import { describe, expect, it } from 'vitest';
import {
  baseInput,
  createEngine,
  createFakePorts,
  performanceAgent,
  reviewAgent,
} from './review-workflow-test-support';

// Regression coverage for the "default model does nothing" defect: each
// layer (schema, agent-definition mapping, sandbox env) had its own tests
// passing while nothing asserted that a value entering at the top (the
// user's stored setting on `PullRequestReviewInput.defaultModel`) actually
// reaches the bottom (the model handed to the sandbox). configuration
// .defaultModel is 'sonnet' — see createEngine() in review-workflow-test-support.ts.
describe('ReviewWorkflowEngine default model resolution', () => {
  it.each([
    ['opus', 'opus'],
    [undefined, 'sonnet'],
    // The web app's save validation never persists 'inherit' or garbage, but
    // the engine should not depend on a rule enforced outside its own
    // boundary — and the column has no database-level CHECK constraint.
    ['inherit', 'sonnet'],
    ['not-a-real-model', 'sonnet'],
  ])("resolves an 'inherit' agent model given per-user default %j to %j", async (given, want) => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [{ ...baseInput.agents[0]!, model: 'inherit' }],
      defaultModel: given,
    });

    expect(ports.sandbox.runAgentCalls[0]).toMatchObject({ model: want });
  });

  // ensureSupervisor() must adopt a freshly claimed input onto an
  // already-cached supervisor, or settings the user changed since the
  // supervisor was created would silently never take effect.
  it("re-resolves an 'inherit' agent's model on a manual re-review of an already-supervised pull request", async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    const inheritingAgent = { ...baseInput.agents[0]!, model: 'inherit' };

    await engine.startPullRequestReview({
      ...baseInput,
      agents: [inheritingAgent],
      defaultModel: 'sonnet',
    });
    expect(ports.sandbox.runAgentCalls[0]).toMatchObject({ model: 'sonnet' });

    await engine.startPullRequestReview({
      ...baseInput,
      trigger: 'manual',
      agents: [inheritingAgent],
      defaultModel: 'opus',
    });

    expect(ports.sandbox.runAgentCalls[1]).toMatchObject({ model: 'opus' });
  });

  // A run's own agents must resolve 'inherit' from the input captured once
  // when that run started, not by re-reading the now-mutable
  // supervisor.input — otherwise a concurrent duplicate intent refreshing it
  // mid-run could make agent #2 pick up a different default than agent #1.
  it('resolves every inherit agent in one run from a single captured default, even with a concurrent mid-run refresh', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const inheritingAgents = [
      { ...reviewAgent, model: 'inherit' },
      { ...performanceAgent, model: 'inherit' },
    ];

    const firstRun = engine.startPullRequestReview({
      ...baseInput,
      agents: inheritingAgents,
      defaultModel: 'sonnet',
    });
    await ports.sandbox.waitForRunningAgent();

    // Duplicate 'opened' intent, arriving while agent #1 is held: refreshes
    // supervisor.input without starting a second run (same runId, in flight).
    const duplicateStart = engine.startPullRequestReview({
      ...baseInput,
      agents: inheritingAgents,
      defaultModel: 'opus',
    });
    ports.sandbox.resolveHeldAgents();
    await Promise.all([firstRun, duplicateStart]);

    expect(ports.sandbox.runAgentCalls.map((call) => call.model)).toEqual(['sonnet', 'sonnet']);
  });

  // ensureSupervisor() can be entered twice for the same pull request before
  // the first call's createSupervisor() (sandbox/Check-Run/DB setup) settles.
  // The second caller must resolve its own run against its own input, not
  // silently inherit whatever the first caller passed in.
  it("resolves each concurrent caller's own default model even when their supervisor creation races", async () => {
    const ports = createFakePorts({ unboundedReservationAmountUsd: 0.01 });
    const engine = createEngine(ports);
    const inheritingAgent = { ...baseInput.agents[0]!, model: 'inherit' };

    // No `await` between these two calls: both run synchronously up through
    // ensureSupervisor's promise-map check before createSupervisor's first
    // internal await yields, so the second call races the same in-flight
    // supervisor creation the first call just started.
    const opened = engine.startPullRequestReview({
      ...baseInput,
      trigger: 'opened',
      agents: [inheritingAgent],
      defaultModel: 'sonnet',
    });
    const manual = engine.startPullRequestReview({
      ...baseInput,
      trigger: 'manual',
      agents: [inheritingAgent],
      defaultModel: 'opus',
    });
    await Promise.all([opened, manual]);

    // Order between the two concurrent runs isn't guaranteed; what matters is
    // that neither call's model leaked into the other's run.
    expect(ports.sandbox.runAgentCalls.map((call) => call.model).sort()).toEqual([
      'opus',
      'sonnet',
    ]);
  });
});
