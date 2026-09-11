import { afterAll, describe, expect, it, vi } from 'vitest';

// E2E mode selects the request-scoped database proxy branch of the factory. The
// mount is a per-process singleton (the library throws on a second
// construction), so this branch gets its own file: Vitest's module isolation
// gives it a fresh singleton, and the production-path branch is covered in
// `mount.factory.test.ts`.
const mockEnv: Record<string, string | undefined> = { E2E_TEST_MODE: '1' };
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { createTribunalMcpMount } = await import('./mount');

let shutdownTransport: (() => Promise<void>) | null = null;

afterAll(async () => {
  await shutdownTransport?.();
});

describe('createTribunalMcpMount (E2E mode)', () => {
  it('backs the mount with the request-scoped db proxy instead of a Postgres pool', async () => {
    // No DATABASE_URL and no storage seam: the E2E branch must construct the
    // mount from the shared `db` proxy alone, which the E2E handle later routes
    // to each worker's PGlite. Construction touches no database, so it succeeds
    // here without a live connection.
    const mount = await createTribunalMcpMount();
    shutdownTransport = mount.shutdownTransport;
    expect(mount.mount).toBeDefined();
    expect(typeof mount.shutdownTransport).toBe('function');
    // The E2E branch runs no sweep and owns no pool, so both are no-ops that
    // still resolve (exercised here so the shutdown phases are covered).
    expect(mount.stopCleanupSweep()).toBeUndefined();
    await expect(mount.disposePool()).resolves.toBeUndefined();
  });
});
