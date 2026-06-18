import {
  Engine,
  MemoryStorage,
  assertDurableStorageForRecovery,
  workflow,
} from '@lostgradient/weft';
import type { Storage } from '@lostgradient/weft';
import type { EngineHealthDependency } from '../health';
import type { StopReviewRunResult } from './review-workflow';

const engineHeartbeat = workflow({ name: 'engine-heartbeat' }).execute(async function* () {
  yield* [];
  return { ok: true };
});

export type EngineBootstrapOptions = {
  storage?: Storage;
  lock?: EngineSingletonLock;
  healthDependencies?: EngineHealthDependency[];
  reviewIntentConsumer?: ReviewIntentConsumer;
  reviewIntentPollIntervalMs?: number;
  allowEphemeralStorageForTests?: boolean;
};

export type ReviewIntentConsumer = {
  workflows?: Record<string, unknown>;
  bindWorkflowEngine?(engine: ReviewIntentWorkflowEngine): void;
  drain(limit?: number): Promise<number>;
  reapClosedPullRequestSandboxes?(): Promise<unknown>;
  stopReviewRun?(reviewRunId: string): Promise<StopReviewRunResult>;
};

export type ReviewIntentWorkflowEngine = {
  start(
    workflowName: 'review-pr' | 'sandbox-reaper',
    input: unknown,
    options: unknown,
  ): Promise<unknown>;
};

export type EngineSingletonLock = {
  acquire(): Promise<EngineSingletonLease>;
};

export type EngineSingletonLease = {
  release(): Promise<void>;
};

export type EngineRuntime = {
  engine: unknown;
  healthDependencies(): EngineHealthDependency[];
  drainReviewIntents(limit?: number): Promise<number>;
  reapClosedPullRequestSandboxes(): Promise<unknown>;
  stopReviewRun(reviewRunId: string): Promise<StopReviewRunResult>;
  release(): Promise<void>;
};

type DisposableEngine = {
  [Symbol.asyncDispose]?(): Promise<void> | void;
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
      ownership: 'lease',
      leaseWaitTimeout: '60s',
      detectSecondInstance: true,
    });
    options.reviewIntentConsumer?.bindWorkflowEngine?.(engine as ReviewIntentWorkflowEngine);

    const poller = createReviewIntentPoller(
      options.reviewIntentConsumer,
      options.reviewIntentPollIntervalMs ?? 1_000,
    );

    return {
      engine,
      healthDependencies() {
        return createRuntimeHealthDependencies(options.healthDependencies);
      },
      drainReviewIntents(limit?: number) {
        return options.reviewIntentConsumer?.drain(limit) ?? Promise.resolve(0);
      },
      reapClosedPullRequestSandboxes() {
        return (
          options.reviewIntentConsumer?.reapClosedPullRequestSandboxes?.() ?? Promise.resolve([])
        );
      },
      stopReviewRun(reviewRunId: string) {
        return (
          options.reviewIntentConsumer?.stopReviewRun?.(reviewRunId) ??
          Promise.resolve({ stopped: false })
        );
      },
      async release() {
        poller.stop();
        try {
          await (engine as DisposableEngine)[Symbol.asyncDispose]?.();
        } finally {
          await lease?.release();
        }
      },
    };
  } catch (error) {
    await lease?.release();
    throw error;
  }
}

function createRuntimeHealthDependencies(
  dependencies: EngineHealthDependency[] | undefined,
): EngineHealthDependency[] {
  const runtimeDependencies = dependencies ?? [{ name: 'weft_database', ok: true }];
  if (runtimeDependencies.some((dependency) => dependency.name === 'singleton_lock')) {
    return runtimeDependencies;
  }

  return [
    ...runtimeDependencies,
    { name: 'singleton_lock', ok: true, detail: 'Weft lease ownership active' },
  ];
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
