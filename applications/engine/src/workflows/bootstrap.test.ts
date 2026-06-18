import { describe, expect, it, vi } from 'vitest';
import { workflow } from '@lostgradient/weft';
import {
  createEngineRuntime,
  type EngineSingletonLease,
  type EngineSingletonLock,
} from './bootstrap';

describe('createEngineRuntime', () => {
  it('fails fast when a second engine cannot acquire the singleton lock', async () => {
    const lock = new FakeEngineSingletonLock();
    const firstRuntime = await createEngineRuntime({ allowEphemeralStorageForTests: true, lock });

    await expect(
      createEngineRuntime({ allowEphemeralStorageForTests: true, lock }),
    ).rejects.toThrow('Another review engine already holds the singleton lock.');

    await firstRuntime.release();
    const secondRuntime = await createEngineRuntime({ allowEphemeralStorageForTests: true, lock });
    await secondRuntime.release();
  });

  it('drains review intents through the runtime consumer', async () => {
    const consumer = {
      drain: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
    };
    const runtime = await createEngineRuntime({
      allowEphemeralStorageForTests: true,
      reviewIntentConsumer: consumer,
      reviewIntentPollIntervalMs: 60_000,
    });

    await vi.waitFor(() => expect(consumer.drain).toHaveBeenCalledTimes(1));
    await expect(runtime.drainReviewIntents(5)).resolves.toBe(1);
    expect(consumer.drain).toHaveBeenLastCalledWith(5);

    await runtime.release();
  });

  it('registers review workflows and binds the created Weft engine to the consumer', async () => {
    const bindWorkflowEngine = vi.fn();
    const reviewWorkflow = workflow({ name: 'review-pr' }).execute(async function* () {
      yield* [];
      return { ok: true };
    });
    const runtime = await createEngineRuntime({
      allowEphemeralStorageForTests: true,
      reviewIntentConsumer: {
        workflows: { 'review-pr': reviewWorkflow },
        bindWorkflowEngine,
        drain: vi.fn().mockResolvedValue(0),
      },
      reviewIntentPollIntervalMs: 60_000,
    });

    expect(bindWorkflowEngine).toHaveBeenCalledWith(runtime.engine);
    expect(
      (runtime.engine as { listWorkflowDefinitions(): Array<{ type: string }> })
        .listWorkflowDefinitions()
        .map((definition) => definition.type),
    ).toContain('review-pr');

    await runtime.release();
  });

  it('reports singleton ownership only after the runtime is created', async () => {
    const runtime = await createEngineRuntime({
      allowEphemeralStorageForTests: true,
      healthDependencies: [{ name: 'weft_database', ok: true }],
    });

    expect(runtime.healthDependencies()).toEqual([
      { name: 'weft_database', ok: true },
      { name: 'singleton_lock', ok: true, detail: 'Weft lease ownership active' },
    ]);

    await runtime.release();
  });
});

class FakeEngineSingletonLock implements EngineSingletonLock {
  private held = false;

  async acquire(): Promise<EngineSingletonLease> {
    if (this.held) {
      throw new Error('Another review engine already holds the singleton lock.');
    }

    this.held = true;
    return {
      release: async () => {
        this.held = false;
      },
    };
  }
}
