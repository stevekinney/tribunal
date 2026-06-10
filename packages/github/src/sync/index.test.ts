import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, workflow, WorkflowNotRegisteredError } from '@lostgradient/weft';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';
import type { WeftClient } from '@lostgradient/weft/client';
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

/** Context whose client resolver rejects (e.g. engine build / storage outage). */
function createContextWithFailingResolver(error: Error): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
    resolveWeftClient: () => Promise.reject(error),
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
  it('uses the caller-supplied deliveryId as the signalId (for redelivery dedup)', async () => {
    const startOrSignal = vi.fn().mockResolvedValue({ id: EXPECTED_ID });
    const context = createContext({ startOrSignal });

    const result = await enqueueInstallationSync(context, { ...options, deliveryId: 'guid-123' });

    expect(result).toEqual({ workflowId: EXPECTED_ID, status: 'started' });
    expect(startOrSignal).toHaveBeenCalledWith(
      'installation-sync',
      { ...options, deliveryId: 'guid-123' },
      {
        name: 'sync_requested',
        payload: { ...options, deliveryId: 'guid-123' },
        signalId: 'guid-123',
      },
      { id: EXPECTED_ID },
    );
  });

  it('mints a fresh, distinct signalId per enqueue when no deliveryId is given', async () => {
    const startOrSignal = vi.fn().mockResolvedValue({ id: EXPECTED_ID });
    const context = createContext({ startOrSignal });

    await enqueueInstallationSync(context, options);
    await enqueueInstallationSync(context, options);

    const idA = (startOrSignal.mock.calls[0][2] as { signalId: string }).signalId;
    const idB = (startOrSignal.mock.calls[1][2] as { signalId: string }).signalId;
    expect(idA).toEqual(expect.any(String));
    expect(idA.length).toBeGreaterThan(0);
    expect(idB).not.toBe(idA);
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

  it('reports an error result (does not throw) when the client resolver rejects', async () => {
    const context = createContextWithFailingResolver(new Error('engine build failed'));

    const result = await enqueueInstallationSync(context, options);

    expect(result).toEqual({
      workflowId: EXPECTED_ID,
      status: 'error',
      error: 'engine build failed',
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

  it('start-or-signals a real installation-sync run with the deterministic id', async () => {
    // Stand-in workflow that completes on its first signal, returning the reason
    // it received — deterministic, no sleeps. Proves the producer reaches a real
    // engine via startOrSignal under the expected id.
    const syncWorkflow = workflow({ name: 'installation-sync' }).execute(async function* (ctx) {
      const event = (yield* ctx.waitForSignal('sync_requested')) as { reason?: string };
      return { reason: event?.reason };
    });

    engine = await Engine.create({
      storage: new MemoryStorage(),
      workflows: { 'installation-sync': syncWorkflow },
    });
    const client = new LocalClient(engine);
    const context = createContext(client);

    const result = await enqueueInstallationSync(context, { ...options, deliveryId: 'guid-xyz' });
    expect(result).toEqual({ workflowId: EXPECTED_ID, status: 'started' });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const state = await client.get(EXPECTED_ID);
      if (state?.status === 'completed') {
        expect((state.result as { reason?: string }).reason).toBe('webhook:installation.created');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('installation-sync run did not complete within the polling budget');
  });
});
