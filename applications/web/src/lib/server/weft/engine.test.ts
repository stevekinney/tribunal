import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

// Mocked at the dependency boundary (NeonStorage / Engine.create), not the module
// under test — so the real getWeftClient wiring + memoization runs.
const { neonStorageInstances, engineCreate } = vi.hoisted(() => ({
  neonStorageInstances: [] as Array<{ url: string }>,
  engineCreate: vi.fn(),
}));

vi.mock('@lostgradient/weft/storage/neon', () => ({
  NeonStorage: class {
    url: string;
    constructor(options: { url: string }) {
      this.url = options.url;
      neonStorageInstances.push(this);
    }
  },
}));

vi.mock('@lostgradient/weft/storage/interface', () => ({
  assertDurableStorageForRecovery: vi.fn(),
}));

// Spread the real module and override only Engine.create. engine.ts now
// transitively imports the workflow definitions, which use `workflow`/`signal`
// from this package at module-eval time — so the mock must keep every real
// export and stub only the dependency boundary the test controls.
vi.mock('@lostgradient/weft', async (importActual) => {
  const actual = await importActual<typeof import('@lostgradient/weft')>();
  return { ...actual, Engine: { create: engineCreate } };
});

import {
  createEngine,
  getWeftClient,
  resetWeftClientForTests,
  resolveDurableStorage,
} from './engine';

beforeEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  neonStorageInstances.length = 0;
  engineCreate.mockReset();
  resetWeftClientForTests();
});

afterEach(() => {
  resetWeftClientForTests();
});

/**
 * A mock engine stub. `createEngine` calls `engine.registerWorkflows(...)` and
 * `engine.scheduler.start()` after `Engine.create`, so the stub must provide
 * both. registerWorkflows returns a re-typed view of the same engine in
 * production; here it returns the same stub so the wiring runs without error.
 */
function mockEngine(): {
  id: string;
  registerWorkflows: ReturnType<typeof vi.fn>;
  scheduler: { start: ReturnType<typeof vi.fn> };
} {
  const engine = {
    id: 'engine',
    registerWorkflows: vi.fn(() => engine),
    scheduler: { start: vi.fn() },
  };
  return engine;
}

describe('resolveDurableStorage', () => {
  it('returns null in non-production when no WEFT_DATABASE_URL is set', () => {
    mockEnv.NODE_ENV = 'development';
    expect(resolveDurableStorage()).toBeNull();
  });

  it('returns null and warns (does not throw) in production when no WEFT_DATABASE_URL is set', () => {
    // A config gap must not become a per-dispatch rejection that 500s webhooks.
    mockEnv.NODE_ENV = 'production';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(resolveDurableStorage()).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('WEFT_DATABASE_URL is not set'));

    // Warns at most once per process.
    error.mockClear();
    expect(resolveDurableStorage()).toBeNull();
    expect(error).not.toHaveBeenCalled();

    error.mockRestore();
  });

  it('builds a NeonStorage over WEFT_DATABASE_URL (not DATABASE_URL)', () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.DATABASE_URL = 'postgresql://app/should-not-be-used';
    mockEnv.WEFT_DATABASE_URL = 'postgresql://user:pass@weft.neon.tech/weft?sslmode=require';
    const storage = resolveDurableStorage();
    expect(storage).not.toBeNull();
    expect(neonStorageInstances).toHaveLength(1);
    expect(neonStorageInstances[0].url).toBe(mockEnv.WEFT_DATABASE_URL);
  });
});

describe('getWeftClient', () => {
  it('returns null when no durable store is configured', async () => {
    mockEnv.NODE_ENV = 'development';
    expect(await getWeftClient()).toBeNull();
    // No engine built when there is nothing to build over.
    expect(engineCreate).not.toHaveBeenCalled();
  });

  it('builds one client over the configured store and memoizes it', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.WEFT_DATABASE_URL = 'postgresql://user:pass@weft.neon.tech/weft?sslmode=require';
    engineCreate.mockResolvedValue(mockEngine());

    const first = await getWeftClient();
    const second = await getWeftClient();

    expect(first).toBeInstanceOf(LocalClient);
    expect(second).toBe(first); // same memoized instance
    expect(engineCreate).toHaveBeenCalledTimes(1); // built exactly once
  });

  it('shares one build across concurrent first callers', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.WEFT_DATABASE_URL = 'postgresql://user:pass@weft.neon.tech/weft?sslmode=require';
    engineCreate.mockResolvedValue(mockEngine());

    const [a, b] = await Promise.all([getWeftClient(), getWeftClient()]);

    expect(a).toBe(b);
    expect(engineCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a rejected build — a later call retries', async () => {
    // The bug this guards: a transient storage failure on the first dispatch must
    // not poison every later dispatch for the lifetime of the process.
    mockEnv.NODE_ENV = 'production';
    mockEnv.WEFT_DATABASE_URL = 'postgresql://user:pass@weft.neon.tech/weft?sslmode=require';
    engineCreate.mockRejectedValueOnce(new Error('neon unreachable'));
    engineCreate.mockResolvedValueOnce(mockEngine());

    await expect(getWeftClient()).rejects.toThrow('neon unreachable');

    // Second call retries cleanly rather than reusing the rejected promise.
    const client = await getWeftClient();
    expect(client).toBeInstanceOf(LocalClient);
    expect(engineCreate).toHaveBeenCalledTimes(2);
  });
});

describe('createEngine', () => {
  it('enables the second-instance detector (single-replica backstop)', async () => {
    engineCreate.mockResolvedValue(mockEngine());
    const storage = new MemoryStorage();
    await createEngine(storage);
    expect(engineCreate).toHaveBeenCalledWith(
      expect.objectContaining({ storage, detectSecondInstance: true }),
    );
  });

  it('registers the ported workflow definitions on the engine', async () => {
    const engine = mockEngine();
    engineCreate.mockResolvedValue(engine);

    await createEngine(new MemoryStorage());

    // Both ported workflows must be registered so producer startOrSignal
    // dispatches resolve to a real run instead of WorkflowNotRegisteredError.
    expect(engine.registerWorkflows).toHaveBeenCalledTimes(1);
    const registered = engine.registerWorkflows.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(registered).sort()).toEqual([
      'installation-sync',
      'pull-request-orchestrator',
    ]);
  });

  it('starts the scheduler so ctx.sleep timers fire (weft#586)', async () => {
    // Engine.create does NOT start the scheduler's polling loop; without this
    // call, every ctx.sleep (sync debounce, orchestrator idle timeout) would
    // park forever in production.
    const engine = mockEngine();
    engineCreate.mockResolvedValue(engine);

    await createEngine(new MemoryStorage());

    expect(engine.scheduler.start).toHaveBeenCalledTimes(1);
  });
});
