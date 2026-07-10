import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEngineServerOptions,
  createReviewIntentKickScheduler,
  createStartingEngineServerOptions,
  createStorageConfigurationFromEnvironment,
  parsePort,
  startSandboxReaper,
} from './index';

afterEach(() => {
  vi.useRealTimers();
});

describe('parsePort', () => {
  it('uses the parsed port when PORT is valid', () => {
    expect(parsePort('4321', 3001)).toBe(4321);
  });

  it('falls back when PORT is invalid', () => {
    expect(parsePort('not-a-port', 3001)).toBe(3001);
    expect(parsePort('70000', 3001)).toBe(3001);
  });
});

describe('createEngineServerOptions', () => {
  it('includes a configured bind hostname for Fly private networking', () => {
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
      '::',
    );

    expect(server.hostname).toBe('::');
  });

  it('drains review intents through the runtime endpoint', async () => {
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => 3,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-intents/drain', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    await expect(response.json()).resolves.toEqual({ ok: true, processed: 3 });
  });

  it('rejects unauthenticated review intent drains', async () => {
    let drainCalled = false;
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => {
          drainCalled = true;
          return 3;
        },
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-intents/drain', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(drainCalled).toBe(false);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('starts an authenticated review intent kick without awaiting the drain', async () => {
    const drain = createDeferred<number>();
    const drainReviewIntents = vi.fn().mockReturnValue(drain.promise);
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [],
        drainReviewIntents,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-intents/kick', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, started: true });
    expect(drainReviewIntents).toHaveBeenCalledWith(5);
    drain.resolve(0);
  });

  it('rejects unauthenticated review intent kicks', async () => {
    const scheduler = { kick: vi.fn(), stop: vi.fn() };
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
      undefined,
      scheduler,
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-intents/kick', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(scheduler.kick).not.toHaveBeenCalled();
  });

  it('returns a retryable failure when a kick reaches a released scheduler', async () => {
    const scheduler = {
      kick: vi.fn().mockReturnValue({ started: false, reason: 'released' }),
      stop: vi.fn(),
    };
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
      undefined,
      scheduler,
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-intents/kick', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'engine_released' });
  });

  it('reports runtime health dependencies', async () => {
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: false, detail: 'advisory lock not held' },
        ],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(new Request('http://engine.test/health'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'weft_database', ok: true },
        { name: 'singleton_lock', ok: false, detail: 'advisory lock not held' },
      ],
    });
  });

  it('stops review runs through the runtime endpoint', async () => {
    const stoppedRunIds: string[] = [];
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async (reviewRunId) => {
          stoppedRunIds.push(reviewRunId);
          return { stopped: true };
        },
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-runs/run%3A42%3A7%3Ahead/stop', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(stoppedRunIds).toEqual(['run:42:7:head']);
    await expect(response.json()).resolves.toEqual({ ok: true, stopped: true });
  });

  it('reports inactive review runs through the runtime stop endpoint', async () => {
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-runs/run_1/stop', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'review_run_not_active',
    });
  });

  it('rejects review run stop requests with same-length wrong control tokens', async () => {
    let stopCalled = false;
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => {
          stopCalled = true;
          return { stopped: true };
        },
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-runs/run_1/stop', {
        method: 'POST',
        headers: { authorization: 'Bearer control-tokem' },
      }),
    );

    expect(response.status).toBe(401);
    expect(stopCalled).toBe(false);
  });

  it('stops review agents through the runtime endpoint', async () => {
    const stoppedAgents: Array<{ reviewRunId: string; agentId: string }> = [];
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async (reviewRunId, agentId) => {
          stoppedAgents.push({ reviewRunId, agentId });
          return { stopped: true };
        },
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-runs/run%3A42%3A7%3Ahead/agents/agent_security/stop', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(stoppedAgents).toEqual([{ reviewRunId: 'run:42:7:head', agentId: 'agent_security' }]);
    await expect(response.json()).resolves.toEqual({ ok: true, stopped: true });
  });

  it('reports inactive review agents through the runtime stop endpoint', async () => {
    const server = createEngineServerOptions(
      3001,
      {
        engine: {},
        healthDependencies: () => [
          { name: 'weft_database', ok: true },
          { name: 'singleton_lock', ok: true },
        ],
        drainReviewIntents: async () => 0,
        getReviewIntentQueueStatus: async () => ({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
        stopReviewAgent: async () => ({ stopped: false }),
        release: async () => {},
      },
      'control-token',
    );

    const response = await server.fetch(
      new Request('http://engine.test/review-runs/run_1/agents/agent_security/stop', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'agent_run_not_active',
    });
  });
});

describe('createStartingEngineServerOptions', () => {
  it('binds immediately on the configured Fly hostname while the runtime starts', async () => {
    const server = createStartingEngineServerOptions(3001, 'control-token', '0.0.0.0');

    expect(server.hostname).toBe('0.0.0.0');
    const response = server.fetch(new Request('http://engine.test/health'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'weft_database', ok: false, detail: 'engine runtime is starting' },
        { name: 'singleton_lock', ok: false, detail: 'engine runtime is starting' },
      ],
    });
  });

  it('accepts an authenticated kick while the durable runtime starts', async () => {
    const server = createStartingEngineServerOptions(3001, 'control-token');
    const response = server.fetch(
      new Request('http://engine.test/review-intents/kick', {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, started: false });
  });

  it('rejects unauthenticated kicks while the durable runtime starts', async () => {
    const server = createStartingEngineServerOptions(3001, 'control-token');
    const response = server.fetch(
      new Request('http://engine.test/review-intents/kick', { method: 'POST' }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });
});

describe('createReviewIntentKickScheduler', () => {
  it('releases the runtime and exits after the configured idle window', async () => {
    vi.useFakeTimers();
    const release = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { error: vi.fn(), log: vi.fn() };
    const scheduler = createReviewIntentKickScheduler(
      {
        drainReviewIntents: vi.fn().mockResolvedValue(0),
        getReviewIntentQueueStatus: vi.fn().mockResolvedValue({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        release,
      },
      { idleShutdownSeconds: 1, exit, logger },
    );

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(scheduler.kick()).toEqual({ started: false, reason: 'released' });
    vi.useRealTimers();
  });

  it('does not release from a stale idle check after a kick starts', async () => {
    vi.useFakeTimers();
    const staleQueueStatus = createDeferred<{
      readyCount: number;
      deferredCount: number;
      claimedCount: number;
    }>();
    const release = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { error: vi.fn(), log: vi.fn() };
    const drainReviewIntents = vi.fn().mockResolvedValue(0);
    const getReviewIntentQueueStatus = vi
      .fn()
      .mockResolvedValue({
        readyCount: 0,
        deferredCount: 0,
        claimedCount: 0,
      })
      .mockReturnValueOnce(staleQueueStatus.promise);
    const scheduler = createReviewIntentKickScheduler(
      {
        drainReviewIntents,
        getReviewIntentQueueStatus,
        release,
      },
      { idleShutdownSeconds: 1, exit, logger },
    );

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getReviewIntentQueueStatus).toHaveBeenCalledTimes(1);
    expect(scheduler.kick()).toEqual({ started: true });
    await vi.advanceTimersByTimeAsync(0);

    staleQueueStatus.resolve({
      readyCount: 0,
      deferredCount: 0,
      claimedCount: 0,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(release).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  it('retries idle shutdown when releasing the runtime fails', async () => {
    vi.useFakeTimers();
    const release = vi
      .fn()
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { error: vi.fn(), log: vi.fn() };
    const scheduler = createReviewIntentKickScheduler(
      {
        drainReviewIntents: vi.fn().mockResolvedValue(0),
        getReviewIntentQueueStatus: vi.fn().mockResolvedValue({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        release,
      },
      { idleShutdownSeconds: 1, exit, logger },
    );

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[engine] idle shutdown check failed',
      expect.any(Error),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  it('waits for deferred retry work instead of exiting immediately', async () => {
    vi.useFakeTimers();
    const release = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { error: vi.fn(), log: vi.fn() };
    let queueStatusCalls = 0;
    const scheduler = createReviewIntentKickScheduler(
      {
        drainReviewIntents: vi.fn().mockResolvedValue(0),
        getReviewIntentQueueStatus: vi.fn().mockImplementation(() => {
          queueStatusCalls += 1;
          return Promise.resolve(
            queueStatusCalls === 1
              ? {
                  readyCount: 0,
                  deferredCount: 1,
                  claimedCount: 0,
                  nextAttemptAt: new Date(Date.now() + 2_000),
                }
              : { readyCount: 0, deferredCount: 0, claimedCount: 0 },
          );
        }),
        release,
      },
      { idleShutdownSeconds: 1, exit, logger },
    );

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  it('waits for active claimed review intents before exiting', async () => {
    vi.useFakeTimers();
    const release = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { error: vi.fn(), log: vi.fn() };
    let queueStatusCalls = 0;
    const scheduler = createReviewIntentKickScheduler(
      {
        drainReviewIntents: vi.fn().mockResolvedValue(0),
        getReviewIntentQueueStatus: vi.fn().mockImplementation(() => {
          queueStatusCalls += 1;
          return Promise.resolve(
            queueStatusCalls === 1
              ? {
                  readyCount: 0,
                  deferredCount: 0,
                  claimedCount: 1,
                }
              : { readyCount: 0, deferredCount: 0, claimedCount: 0 },
          );
        }),
        release,
      },
      { idleShutdownSeconds: 1, exit, logger },
    );

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  it('waits for active background work before exiting', async () => {
    vi.useFakeTimers();
    const release = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { error: vi.fn(), log: vi.fn() };
    let backgroundWorkActive = true;
    const scheduler = createReviewIntentKickScheduler(
      {
        drainReviewIntents: vi.fn().mockResolvedValue(0),
        getReviewIntentQueueStatus: vi.fn().mockResolvedValue({
          readyCount: 0,
          deferredCount: 0,
          claimedCount: 0,
        }),
        release,
      },
      {
        idleShutdownSeconds: 1,
        exit,
        logger,
        isBackgroundWorkActive: () => backgroundWorkActive,
      },
    );

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).not.toHaveBeenCalled();

    backgroundWorkActive = false;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });
});

describe('startSandboxReaper', () => {
  it('schedules sandbox cleanup on the configured interval', async () => {
    const runtime = {
      reapClosedPullRequestSandboxes: vi.fn().mockResolvedValue([]),
    };
    const setIntervalFunction = vi.fn((callback: () => void, intervalMs: number) => {
      expect(intervalMs).toBe(300_000);
      callback();
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    });

    startSandboxReaper(300, runtime, setIntervalFunction as typeof setInterval);
    await Promise.resolve();

    expect(setIntervalFunction).toHaveBeenCalledTimes(1);
    expect(runtime.reapClosedPullRequestSandboxes).toHaveBeenCalledTimes(1);
  });

  it('tracks sandbox cleanup activity until the async run settles', async () => {
    const cleanup = createDeferred<unknown[]>();
    const events: string[] = [];
    const runtime = {
      reapClosedPullRequestSandboxes: vi.fn().mockReturnValue(cleanup.promise),
    };
    const setIntervalFunction = vi.fn((callback: () => void) => {
      callback();
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    });

    startSandboxReaper(300, runtime, setIntervalFunction as typeof setInterval, {
      onRunStart: () => events.push('start'),
      onRunComplete: () => events.push('complete'),
    });

    expect(events).toEqual(['start']);
    await Promise.resolve();

    cleanup.resolve([]);
    await flushPromises();

    expect(events).toEqual(['start', 'complete']);
  });

  it('does not schedule sandbox cleanup for non-positive intervals', () => {
    const setIntervalFunction = vi.fn();

    expect(
      startSandboxReaper(
        0,
        { reapClosedPullRequestSandboxes: vi.fn() },
        setIntervalFunction as unknown as typeof setInterval,
      ),
    ).toBeUndefined();

    expect(setIntervalFunction).not.toHaveBeenCalled();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createStorageConfigurationFromEnvironment', () => {
  it('reports configured durable storage and runtime ownership', () => {
    const configuration = createStorageConfigurationFromEnvironment({
      NODE_ENV: 'production',
      WEFT_DATABASE_URL: 'postgres://user:password@localhost:5432/tribunal',
    });

    expect(configuration.allowEphemeralStorageForTests).toBe(false);
    expect(configuration.storage).toBeDefined();
    expect(configuration.healthDependencies).toEqual([
      { name: 'weft_database', ok: true },
      { name: 'singleton_lock', ok: true, detail: 'Postgres advisory lock held' },
    ]);
  });

  it('requires durable storage in production unless explicitly enabled for tests', () => {
    const configuration = createStorageConfigurationFromEnvironment({
      NODE_ENV: 'production',
    });

    expect(configuration.allowEphemeralStorageForTests).toBe(false);
    expect(configuration.storage).toBeUndefined();
    expect(configuration.healthDependencies).toEqual([
      {
        name: 'weft_database',
        ok: false,
        detail: 'WEFT_DATABASE_URL is not configured',
      },
      {
        name: 'singleton_lock',
        ok: false,
        detail: 'durable storage is required before singleton ownership can be acquired',
      },
    ]);
  });

  it('allows ephemeral storage outside production', () => {
    const configuration = createStorageConfigurationFromEnvironment({
      NODE_ENV: 'test',
    });

    expect(configuration.allowEphemeralStorageForTests).toBe(true);
    expect(configuration.storage).toBeUndefined();
    expect(configuration.healthDependencies).toEqual([
      {
        name: 'weft_database',
        ok: true,
        detail: 'ephemeral storage enabled',
      },
      {
        name: 'singleton_lock',
        ok: true,
        detail: 'single-process ephemeral runtime',
      },
    ]);
  });
});
