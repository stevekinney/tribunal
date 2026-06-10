import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, workflow, WorkflowNotRegisteredError } from '@lostgradient/weft';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';
import type { WeftClient } from '@lostgradient/weft/client';
import type { WorkflowState } from '@lostgradient/weft';
import type { GithubServiceContext } from '../context.js';
import { enqueueInstallationSync } from './index.js';
import type { EnqueueInstallationSyncOptions } from './types.js';

function createContext(weftClient?: Partial<WeftClient>): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
    resolveWeftClient: () => Promise.resolve((weftClient as WeftClient | undefined) ?? null),
  };
}

const options: EnqueueInstallationSyncOptions = {
  installationId: 555,
  reason: 'webhook:installation.created',
  workspaceId: 1,
  triggeredByUserId: 9,
};

const EXPECTED_ID = 'github:installations:555:sync';

describe('enqueueInstallationSync', () => {
  it('start-or-signals the per-installation sync workflow', async () => {
    const startOrSignal = vi.fn().mockResolvedValue({ id: EXPECTED_ID });
    const context = createContext({ startOrSignal });

    const result = await enqueueInstallationSync(context, options);

    expect(result).toEqual({ workflowId: EXPECTED_ID, status: 'started' });
    expect(startOrSignal).toHaveBeenCalledWith(
      'installation-sync',
      options,
      { name: 'sync_requested', payload: options, signalId: expect.any(String) },
      { id: EXPECTED_ID },
    );
  });

  it('falls back to log-only "started" when no engine is configured', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const context = createContext(undefined);

    const result = await enqueueInstallationSync(context, options);

    expect(result).toEqual({ workflowId: EXPECTED_ID, status: 'started' });
    expect(log).toHaveBeenCalledWith(
      '[sync] would enqueue installation sync (no engine)',
      expect.objectContaining({ workflowId: EXPECTED_ID, installationId: 555 }),
    );
    log.mockRestore();
  });

  it('reports an error result (does not throw) when dispatch fails', async () => {
    const startOrSignal = vi.fn().mockRejectedValue(new Error('engine unreachable'));
    const context = createContext({ startOrSignal });

    const result = await enqueueInstallationSync(context, options);

    expect(result).toEqual({
      workflowId: EXPECTED_ID,
      status: 'error',
      error: 'engine unreachable',
    });
  });

  it('reports "started" when the sync workflow is not registered yet', async () => {
    const startOrSignal = vi
      .fn()
      .mockRejectedValue(new WorkflowNotRegisteredError('installation-sync'));
    const context = createContext({ startOrSignal });

    const result = await enqueueInstallationSync(context, options);

    expect(result).toEqual({ workflowId: EXPECTED_ID, status: 'started' });
  });
});

describe('enqueueInstallationSync (e2e, real engine)', () => {
  let engine: Engine | undefined;

  afterEach(async () => {
    await engine?.[Symbol.asyncDispose]?.();
    engine = undefined;
  });

  it('starts a real installation-sync run and completes it', async () => {
    // A minimal sync workflow that records each sync_requested signal's reason
    // then finishes on a terminating one. Proves the producer's start-or-signal
    // reaches a real engine and drives a run to completion.
    const syncWorkflow = workflow({ name: 'installation-sync' }).execute(async function* (ctx) {
      const reasons: string[] = [];
      let done = false;
      while (!done) {
        const event = (yield* ctx.waitForSignal('sync_requested')) as {
          reason?: string;
          __terminate?: boolean;
        };
        if (event?.reason) reasons.push(event.reason);
        if (event?.__terminate) done = true;
      }
      return { reasons };
    });

    engine = await Engine.create({
      storage: new MemoryStorage(),
      workflows: { 'installation-sync': syncWorkflow },
    });
    const client = new LocalClient(engine);
    const context = createContext(client);

    const result = await enqueueInstallationSync(context, options);
    expect(result).toEqual({ workflowId: EXPECTED_ID, status: 'started' });

    // Let the start signal be consumed before the next arrives (same-tick bursts
    // can drop the start payload in Weft 0.3.0 — weft#458).
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Terminating signal on the same channel completes the run.
    await client.signal(EXPECTED_ID, 'sync_requested', {
      reason: 'shutdown',
      __terminate: true,
    });

    const terminal: ReadonlyArray<WorkflowState['status']> = [
      'completed',
      'failed',
      'cancelled',
      'timed-out',
    ];
    let state: WorkflowState | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      state = await client.get(EXPECTED_ID);
      if (state && terminal.includes(state.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(state?.status).toBe('completed');
    const output = state?.result as { reasons: string[] };
    expect(output.reasons).toEqual(['webhook:installation.created', 'shutdown']);
  });
});
