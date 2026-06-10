import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

import { createEngine, getEngine, getWeftClient, resolveDurableStorage } from './engine';
import { getWeftConfiguration } from './configuration';

beforeEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe('resolveDurableStorage', () => {
  it('returns null in non-production when no WEFT_DATABASE_URL is set', () => {
    mockEnv.NODE_ENV = 'development';
    expect(resolveDurableStorage(getWeftConfiguration())).toBeNull();
  });

  it('throws in production when no WEFT_DATABASE_URL is set', () => {
    mockEnv.NODE_ENV = 'production';
    expect(() => resolveDurableStorage(getWeftConfiguration())).toThrow(
      /WEFT_DATABASE_URL is required/,
    );
  });

  it('builds a NeonStorage when WEFT_DATABASE_URL is set', () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.WEFT_DATABASE_URL = 'postgresql://user:pass@example.neon.tech/weft?sslmode=require';
    // NeonStorage constructs a pool lazily; building it must not throw.
    const storage = resolveDurableStorage(getWeftConfiguration());
    expect(storage).not.toBeNull();
    expect(storage).toHaveProperty('get');
    expect(storage).toHaveProperty('batch');
  });
});

describe('getEngine / getWeftClient (the functions github-context loads)', () => {
  it('return null in non-production when no durable store is configured', async () => {
    // This is the path production loads today: no WEFT_DATABASE_URL -> the web
    // context wires a null client and producers run log-only.
    mockEnv.NODE_ENV = 'development';
    expect(await getEngine()).toBeNull();
    expect(await getWeftClient()).toBeNull();
  });
});

describe('createEngine + LocalClient (real engine over memory storage)', () => {
  let dispose: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await dispose?.();
    dispose = undefined;
  });

  it('builds an engine and a working LocalClient that dispatches', async () => {
    // Exercises the same createEngine + LocalClient path the production factory
    // uses, with an injected backend (the prod factory chooses NeonStorage).
    const engine = await createEngine(new MemoryStorage());
    dispose = async () => {
      await (engine as unknown as { [Symbol.asyncDispose]?: () => Promise<void> })[
        Symbol.asyncDispose
      ]?.();
    };
    const client = new LocalClient(engine);
    expect(client).toBeInstanceOf(LocalClient);

    // An empty registry means no workflow is registered. A producer-style
    // dispatch must surface WorkflowNotRegisteredError (which the producers
    // translate into a no-op success) rather than silently succeeding.
    await expect(
      client.startOrSignal(
        'pull-request-orchestrator',
        {},
        { name: 'pull_request_event', payload: {}, signalId: 'x' },
        { id: 'pull-request-orchestrator:1:1' },
      ),
    ).rejects.toMatchObject({ code: 'WorkflowNotRegisteredError' });
  });
});
