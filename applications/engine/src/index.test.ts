import { describe, expect, it, vi } from 'vitest';
import {
  createEngineServerOptions,
  createStorageConfigurationFromEnvironment,
  parsePort,
  startSandboxReaper,
} from './index';

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
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
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
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
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
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
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
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async (reviewRunId) => {
          stoppedRunIds.push(reviewRunId);
          return { stopped: true };
        },
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
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => ({ stopped: false }),
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
        reapClosedPullRequestSandboxes: async () => [],
        stopReviewRun: async () => {
          stopCalled = true;
          return { stopped: true };
        },
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
});

describe('startSandboxReaper', () => {
  it('schedules sandbox cleanup on the configured interval', () => {
    const runtime = {
      reapClosedPullRequestSandboxes: vi.fn().mockResolvedValue([]),
    };
    const setIntervalFunction = vi.fn((callback: () => void, intervalMs: number) => {
      expect(intervalMs).toBe(300_000);
      callback();
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    });

    startSandboxReaper(300, runtime, setIntervalFunction as typeof setInterval);

    expect(setIntervalFunction).toHaveBeenCalledTimes(1);
    expect(runtime.reapClosedPullRequestSandboxes).toHaveBeenCalledTimes(1);
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
