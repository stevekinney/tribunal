import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const storageDispose = vi.fn(() => Promise.resolve());
const createOAuthStorageSeam = vi.fn();
vi.mock('@tribunal/database/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tribunal/database/queries')>();
  return { ...actual, createOAuthStorageSeam };
});

const { createOAuthStores } = await import('@tribunal/database/queries');
const { createTribunalMcpMount } = await import('./mount');

const CONNECTION_STRING = 'postgresql://user:pass@localhost:5432/db';

let database: TestDatabase;

afterAll(async () => {
  if (database) await database.close();
});

describe('createTribunalMcpMount', () => {
  it('throws when DATABASE_URL is not configured', async () => {
    mockEnv.DATABASE_URL = undefined;
    await expect(createTribunalMcpMount()).rejects.toThrow('DATABASE_URL is required');
  });

  it('constructs the mount and disposes storage alongside it', async () => {
    database = await createTestDatabase();
    mockEnv.DATABASE_URL = CONNECTION_STRING;
    createOAuthStorageSeam.mockReturnValue({
      stores: createOAuthStores(database.db),
      dispose: storageDispose,
    });

    const { mount, dispose } = await createTribunalMcpMount();
    expect(mount).toBeDefined();
    expect(createOAuthStorageSeam).toHaveBeenCalledWith(CONNECTION_STRING);

    await dispose();
    expect(storageDispose).toHaveBeenCalledOnce();
  });

  it('disposes storage when mount construction fails', async () => {
    // The mount was disposed above, so the library refuses to construct another;
    // the factory must release the freshly-opened storage pool before rethrowing.
    storageDispose.mockClear();
    mockEnv.DATABASE_URL = CONNECTION_STRING;
    createOAuthStorageSeam.mockReturnValue({
      stores: createOAuthStores(database.db),
      dispose: storageDispose,
    });

    await expect(createTribunalMcpMount()).rejects.toThrow();
    expect(storageDispose).toHaveBeenCalledOnce();
  });
});
