import { user } from '@tribunal/database/schema';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from './database';

describe('createTestDatabase', () => {
  // Schema application and reset() are exercised against a single shared
  // instance in beforeAll/afterEach so the ~11s PGlite cold start only
  // happens once, well inside the 30s hookTimeout, instead of once per test
  // body against the 15s testTimeout.
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  afterEach(async () => {
    await testDb.reset();
  });

  it('applies the schema and returns a working drizzle database', async () => {
    const [inserted] = await testDb.db
      .insert(user)
      .values({ username: 'schema-check-user' })
      .returning();

    expect(inserted.username).toBe('schema-check-user');
  });

  it('reset() truncates user tables while leaving the schema intact', async () => {
    await testDb.db.insert(user).values({ username: 'to-be-reset' }).returning();
    const beforeReset = await testDb.client.query<{ count: number }>('SELECT COUNT(*) FROM "user"');
    expect(Number(beforeReset.rows[0]?.count)).toBe(1);

    await testDb.reset();

    const afterReset = await testDb.client.query<{ count: number }>('SELECT COUNT(*) FROM "user"');
    expect(Number(afterReset.rows[0]?.count)).toBe(0);
  });

  it('reset() restarts identity sequences so ids are predictable again', async () => {
    const [first] = await testDb.db.insert(user).values({ username: 'first' }).returning();
    await testDb.reset();
    const [second] = await testDb.db.insert(user).values({ username: 'second' }).returning();

    expect(second.id).toBe(first.id);
  });

  it('warns when initialization exceeds the slow-init threshold', async () => {
    // By this point PGlite's WASM module is already warm (loaded once for
    // the whole file), so this createTestDatabase() call itself runs in a
    // couple of seconds -- well inside the 15s testTimeout. A counter-based
    // performance.now() mock guarantees totalElapsed exceeds the 20s warning
    // threshold regardless of how fast that warm init actually completes.
    let tick = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      tick += 21_000;
      return tick;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let extraDb: TestDatabase | null = null;

    try {
      extraDb = await createTestDatabase();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Slow PGlite init'));
    } finally {
      nowSpy.mockRestore();
      warnSpy.mockRestore();
      if (extraDb) await extraDb.close();
    }
  });
});
