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

vi.mock('@lostgradient/weft', () => ({
  Engine: { create: engineCreate },
}));

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

describe('resolveDurableStorage', () => {
  it('returns null in non-production when no WEFT_DATABASE_URL is set', () => {
    mockEnv.NODE_ENV = 'development';
    expect(resolveDurableStorage()).toBeNull();
  });

  it('throws in production when no WEFT_DATABASE_URL is set', () => {
    mockEnv.NODE_ENV = 'production';
    expect(() => resolveDurableStorage()).toThrow(/WEFT_DATABASE_URL is required/);
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
    engineCreate.mockResolvedValue({ id: 'engine' });

    const first = await getWeftClient();
    const second = await getWeftClient();

    expect(first).toBeInstanceOf(LocalClient);
    expect(second).toBe(first); // same memoized instance
    expect(engineCreate).toHaveBeenCalledTimes(1); // built exactly once
  });

  it('shares one build across concurrent first callers', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.WEFT_DATABASE_URL = 'postgresql://user:pass@weft.neon.tech/weft?sslmode=require';
    engineCreate.mockResolvedValue({ id: 'engine' });

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
    engineCreate.mockResolvedValueOnce({ id: 'engine' });

    await expect(getWeftClient()).rejects.toThrow('neon unreachable');

    // Second call retries cleanly rather than reusing the rejected promise.
    const client = await getWeftClient();
    expect(client).toBeInstanceOf(LocalClient);
    expect(engineCreate).toHaveBeenCalledTimes(2);
  });
});

describe('createEngine', () => {
  it('enables the second-instance detector (single-replica backstop)', async () => {
    engineCreate.mockResolvedValue({ id: 'engine' });
    const storage = new MemoryStorage();
    await createEngine(storage);
    expect(engineCreate).toHaveBeenCalledWith(
      expect.objectContaining({ storage, detectSecondInstance: true }),
    );
  });
});
