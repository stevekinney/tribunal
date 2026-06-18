import { describe, expect, it } from 'vitest';
import {
  createEngineServerOptions,
  createStorageConfigurationFromEnvironment,
  parsePort,
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
});

describe('createStorageConfigurationFromEnvironment', () => {
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
