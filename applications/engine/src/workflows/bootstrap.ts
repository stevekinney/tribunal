import {
  Engine,
  MemoryStorage,
  assertDurableStorageForRecovery,
  workflow,
} from '@lostgradient/weft';
import type { Storage } from '@lostgradient/weft';

const engineHeartbeat = workflow({ name: 'engine-heartbeat' }).execute(async function* () {
  return { ok: true };
});

export type EngineBootstrapOptions = {
  storage?: Storage;
  lock?: EngineSingletonLock;
  reviewIntentConsumer?: ReviewIntentConsumer;
  reviewIntentPollIntervalMs?: number;
  allowEphemeralStorageForTests?: boolean;
};

export type ReviewIntentConsumer = {
  workflows?: Record<string, unknown>;
  bindWorkflowEngine?(engine: ReviewIntentWorkflowEngine): void;
  drain(limit?: number): Promise<number>;
};

export type ReviewIntentWorkflowEngine = {
  start(workflowName: 'review-pr', input: unknown, options: unknown): Promise<unknown>;
};

export type EngineSingletonLock = {
  acquire(): Promise<EngineSingletonLease>;
};

export type EngineSingletonLease = {
  release(): Promise<void>;
};

export type EngineRuntime = {
  engine: unknown;
  drainReviewIntents(limit?: number): Promise<number>;
  release(): Promise<void>;
};

export async function createEngineRuntime(
  options: EngineBootstrapOptions = {},
): Promise<EngineRuntime> {
  const storage = options.storage ?? new MemoryStorage();
  if (!options.allowEphemeralStorageForTests) {
    await assertDurableStorageForRecovery(storage);
  }
  const lease = await options.lock?.acquire();

  try {
    const engine = await Engine.create({
      storage,
      workflows: {
        'engine-heartbeat': engineHeartbeat,
        ...(options.reviewIntentConsumer?.workflows ?? {}),
      },
    });
    options.reviewIntentConsumer?.bindWorkflowEngine?.(engine as ReviewIntentWorkflowEngine);

    const poller = createReviewIntentPoller(
      options.reviewIntentConsumer,
      options.reviewIntentPollIntervalMs ?? 1_000,
    );

    return {
      engine,
      drainReviewIntents(limit?: number) {
        return options.reviewIntentConsumer?.drain(limit) ?? Promise.resolve(0);
      },
      async release() {
        poller.stop();
        await lease?.release();
      },
    };
  } catch (error) {
    await lease?.release();
    throw error;
  }
}

function createReviewIntentPoller(
  consumer: ReviewIntentConsumer | undefined,
  intervalMs: number,
): { stop(): void } {
  if (consumer === undefined) return { stop() {} };

  let running = false;
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      await consumer.drain();
    } catch (error) {
      console.error('[engine] review intent drain failed', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void drain();
  }, intervalMs);
  timer.unref?.();
  void drain();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
