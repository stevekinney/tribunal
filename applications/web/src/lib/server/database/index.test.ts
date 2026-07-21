import { describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ DATABASE_URL: undefined as string | undefined }));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { db } from './index';

describe('db (lazy connection resolver)', () => {
  it('throws a descriptive error when DATABASE_URL is not configured and no override is active', () => {
    // Accessing any property on the lazily-connected `db` proxy triggers the
    // resolver thunk outside of `runWithDatabase`'s AsyncLocalStorage override.
    expect(() => db.select).toThrow(
      'DATABASE_URL environment variable is required for the web application',
    );
  });

  it('resolves and constructs a client without connecting when DATABASE_URL is configured', () => {
    mockEnv.DATABASE_URL = 'postgres://user:pass@localhost:5432/tribunal';

    // Constructing the drizzle client does not open a socket eagerly — this
    // only proves the resolver's success path (returning the URL) runs.
    expect(() => db.select).not.toThrow();
  });
});
