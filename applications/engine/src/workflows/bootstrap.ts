import {
  Engine,
  MemoryStorage,
  assertDurableStorageForRecovery,
  workflow,
  type WorkflowStatus,
} from '@lostgradient/weft';
import { LocalClient } from '@lostgradient/weft/client/local';
import type { EngineLeaseHealth, Storage } from '@lostgradient/weft';
import { dispatchInstallationSync } from '@tribunal/github/sync';
import type {
  EnqueueInstallationSyncOptions,
  EnqueueInstallationSyncResult,
} from '@tribunal/github/sync/types';
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

export type ReviewIntentQueueStatus = {
  readyCount: number;
  deferredCount: number;
  claimedCount: number;
  nextAttemptAt?: Date;
};

export type ReviewIntentConsumer = {
  workflows?: Record<string, unknown>;
  bindWorkflowEngine?(engine: ReviewIntentWorkflowEngine): void;
  drain(limit?: number): Promise<number>;
  consumePendingDrain?(): boolean;
  getQueueStatus?(now: Date): Promise<ReviewIntentQueueStatus>;
  reapClosedPullRequestSandboxes?(): Promise<unknown>;
  stopReviewRun?(reviewRunId: string): Promise<StopReviewRunResult>;
  stopReviewAgent?(reviewRunId: string, agentId: string): Promise<StopReviewRunResult>;
};

export type ReviewIntentWorkflowEngine = {
  start(
    workflowName: 'review-pr' | 'sandbox-reaper',
    input: unknown,
    options: unknown,
  ): Promise<unknown>;
  getLeaseHealth(): EngineLeaseHealth;
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
  consumePendingReviewIntentDrain?(): boolean;
  getReviewIntentQueueStatus(now: Date): Promise<ReviewIntentQueueStatus>;
  reapClosedPullRequestSandboxes(): Promise<unknown>;
  hasActiveInstallationSyncs?(): Promise<boolean>;
  cancelInstallationSync?(installationId: number): Promise<void>;
  enqueueInstallationSync?(
    options: EnqueueInstallationSyncOptions,
  ): Promise<EnqueueInstallationSyncResult>;
  stopReviewRun(reviewRunId: string): Promise<StopReviewRunResult>;
  stopReviewAgent(reviewRunId: string, agentId: string): Promise<StopReviewRunResult>;
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
    const client = new LocalClient(engine);
    options.reviewIntentConsumer?.bindWorkflowEngine?.(engine as ReviewIntentWorkflowEngine);
    const drainReviewIntents = createSerializedReviewIntentDrain(options.reviewIntentConsumer);

    const poller = createReviewIntentPoller(
      options.reviewIntentConsumer === undefined ? undefined : drainReviewIntents,
      options.reviewIntentPollIntervalMs ?? 1_000,
    );

    // The idle-shutdown scheduler and a termination-signal handler can both
    // reach `release()`. Dedupe on a single in-flight promise so concurrent
    // callers share one dispose+release rather than double-disposing — but clear
    // it on failure so a later shutdown attempt can retry and the singleton
    // lease/advisory lock is never left held after a transient error.
    let releasePromise: Promise<void> | undefined;

    return {
      engine,
      healthDependencies() {
        return createRuntimeHealthDependencies(
          options.healthDependencies,
          (engine as { getLeaseHealth(): EngineLeaseHealth }).getLeaseHealth(),
        );
      },
      drainReviewIntents(limit?: number) {
        return drainReviewIntents(limit);
      },
      consumePendingReviewIntentDrain() {
        return options.reviewIntentConsumer?.consumePendingDrain?.() ?? false;
      },
      getReviewIntentQueueStatus(now: Date) {
        return (
          options.reviewIntentConsumer?.getQueueStatus?.(now) ??
          Promise.resolve({ readyCount: 0, deferredCount: 0, claimedCount: 0 })
        );
      },
      reapClosedPullRequestSandboxes() {
        return (
          options.reviewIntentConsumer?.reapClosedPullRequestSandboxes?.() ?? Promise.resolve([])
        );
      },
      async hasActiveInstallationSyncs() {
        const activeStatuses: WorkflowStatus[] = ['pending', 'running', 'suspended'];
        const page = await engine.list({
          type: 'installation-sync',
          status: activeStatuses,
          limit: 1,
        });
        return page.total > 0;
      },
      async cancelInstallationSync(installationId) {
        await engine.cancel(`github:installations:${installationId}:sync`);
      },
      enqueueInstallationSync(options) {
        return dispatchInstallationSync(client, options);
      },
      stopReviewRun(reviewRunId: string) {
        return (
          options.reviewIntentConsumer?.stopReviewRun?.(reviewRunId) ??
          Promise.resolve({ stopped: false })
        );
      },
      stopReviewAgent(reviewRunId: string, agentId: string) {
        return (
          options.reviewIntentConsumer?.stopReviewAgent?.(reviewRunId, agentId) ??
          Promise.resolve({ stopped: false })
        );
      },
      async release() {
        // Weft's own `[Symbol.asyncDispose]` attempts the lease release in a
        // `finally` even when this call rejects (e.g. a queued inline
        // workflow drain failure) -- but `LeaseManager.release()` swallows
        // every storage error internally and never reports success or
        // failure either way. There is currently no signal, throwing or not,
        // that tells us whether the lease record was actually deleted (see
        // stevekinney/weft#853, filed while investigating #211's "shutdown
        // completed WITHOUT releasing the singleton lease" log line). Until
        // that lands, retrying the whole disposal on any error is the best
        // available response -- see `DEFAULT_RELEASE_ATTEMPTS` in `index.ts`,
        // which was widened specifically so this has more of the shutdown
        // window to succeed.
        releasePromise ??= (async () => {
          poller.stop();
          try {
            await (engine as DisposableEngine)[Symbol.asyncDispose]?.();
          } finally {
            await lease?.release();
          }
        })();

        try {
          await releasePromise;
        } catch (error) {
          releasePromise = undefined;
          throw error;
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
  leaseHealth: EngineLeaseHealth,
): EngineHealthDependency[] {
  const runtimeDependencies = dependencies ?? [{ name: 'weft_database', ok: true }];
  const hasSingletonLock = runtimeDependencies.some(
    (dependency) => dependency.name === 'singleton_lock',
  );

  if (!hasSingletonLock) {
    return [
      ...runtimeDependencies,
      { name: 'singleton_lock', ok: true, detail: 'Weft lease ownership active' },
    ];
  }

  // Once lease-mode monitoring is configured (a `singleton_lock` dependency
  // was supplied at boot), reflect the engine's *current* ownership state
  // instead of that boot-time snapshot -- a lease lost sometime after boot
  // must be visible to this health check, not masked by a value that was
  // only ever true at startup.
  return [
    ...runtimeDependencies.filter((dependency) => dependency.name !== 'singleton_lock'),
    {
      name: 'singleton_lock',
      ok: leaseHealth.holdsLease,
      detail: leaseHealth.holdsLease
        ? 'Weft lease ownership active'
        : `Weft lease ownership lost (status: ${leaseHealth.status})`,
    },
  ];
}

function createReviewIntentPoller(
  drainReviewIntents: (() => Promise<number>) | undefined,
  intervalMs: number,
): { stop(): void } {
  if (drainReviewIntents === undefined) return { stop() {} };
  if (intervalMs <= 0) return { stop() {} };

  let running = false;
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      await drainReviewIntents();
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

function createSerializedReviewIntentDrain(
  consumer: ReviewIntentConsumer | undefined,
): (limit?: number) => Promise<number> {
  if (consumer === undefined) return () => Promise.resolve(0);

  let previousDrain: Promise<unknown> = Promise.resolve();

  return (limit?: number) => {
    const drain = previousDrain.catch(() => undefined).then(() => consumer.drain(limit));
    previousDrain = drain.then(
      () => undefined,
      () => undefined,
    );
    return drain;
  };
}
