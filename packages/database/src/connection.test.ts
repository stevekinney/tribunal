import { beforeEach, describe, expect, it, vi } from 'vitest';

const { drizzleNeonHttp, drizzleNodePostgres } = vi.hoisted(() => ({
  drizzleNeonHttp: vi.fn(() => ({ driver: 'neon-http' })),
  drizzleNodePostgres: vi.fn(() => ({ driver: 'node-postgres' })),
}));

vi.mock('drizzle-orm/neon-http', () => ({
  drizzle: drizzleNeonHttp,
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: drizzleNodePostgres,
}));

describe('createDatabase', () => {
  beforeEach(() => {
    drizzleNeonHttp.mockClear();
    drizzleNodePostgres.mockClear();
  });

  it('uses the Neon HTTP driver for Neon database hosts', async () => {
    const { createDatabase } = await import('./connection');

    const database = createDatabase(
      'postgresql://user:password@example.us-east-1.aws.neon.tech/main?sslmode=require',
    );

    expect(database).toEqual({ driver: 'neon-http' });
    expect(drizzleNeonHttp).toHaveBeenCalledOnce();
    expect(drizzleNodePostgres).not.toHaveBeenCalled();
  });

  it('uses the Neon HTTP driver for Neon build database hosts', async () => {
    const { createDatabase } = await import('./connection');

    const database = createDatabase(
      'postgresql://user:password@example.us-east-1.aws.neon.build/main?sslmode=require',
    );

    expect(database).toEqual({ driver: 'neon-http' });
    expect(drizzleNeonHttp).toHaveBeenCalledOnce();
    expect(drizzleNodePostgres).not.toHaveBeenCalled();
  });

  it('uses the Node Postgres driver for local container database hosts', async () => {
    const { createDatabase } = await import('./connection');

    const database = createDatabase(
      'postgres://tribunal:tribunal@host.docker.internal:5433/tribunal',
    );

    expect(database).toEqual({ driver: 'node-postgres' });
    expect(drizzleNodePostgres).toHaveBeenCalledOnce();
    expect(drizzleNeonHttp).not.toHaveBeenCalled();
  });

  describe('deferred connection string', () => {
    it('defers connecting until a property is first accessed', async () => {
      const { createDatabase } = await import('./connection');
      const resolveConnectionString = vi.fn(() => 'postgres://tribunal:tribunal@localhost:5432/db');

      createDatabase(resolveConnectionString);

      expect(resolveConnectionString).not.toHaveBeenCalled();
      expect(drizzleNodePostgres).not.toHaveBeenCalled();
    });

    it('connects lazily on first property access and caches the connection', async () => {
      const { createDatabase } = await import('./connection');
      const resolveConnectionString = vi.fn(() => 'postgres://tribunal:tribunal@localhost:5432/db');

      const database = createDatabase(resolveConnectionString) as unknown as { driver: string };

      expect(database.driver).toBe('node-postgres');
      expect(database.driver).toBe('node-postgres');
      expect(resolveConnectionString).toHaveBeenCalledOnce();
      expect(drizzleNodePostgres).toHaveBeenCalledOnce();
    });

    it('binds functions on the underlying database to the active instance', async () => {
      drizzleNodePostgres.mockReturnValueOnce({
        driver: 'node-postgres',
        query() {
          return this;
        },
      } as unknown as ReturnType<typeof drizzleNodePostgres>);

      const { createDatabase } = await import('./connection');
      const database = createDatabase(() => 'postgres://tribunal:tribunal@localhost:5432/db');

      const boundQuery = (database as unknown as { query: () => unknown }).query;
      expect(boundQuery()).toEqual({ driver: 'node-postgres', query: expect.any(Function) });
    });

    it('routes through an AsyncLocalStorage override installed by runWithDatabase', async () => {
      const { createDatabase, runWithDatabase } = await import('./connection');
      const resolveConnectionString = vi.fn(() => 'postgres://tribunal:tribunal@localhost:5432/db');
      const database = createDatabase(resolveConnectionString) as unknown as { driver: string };
      const overrideDatabase = { driver: 'override' } as unknown as ReturnType<
        typeof createDatabase
      >;

      const result = runWithDatabase(overrideDatabase, () => database.driver);

      expect(result).toBe('override');
      expect(resolveConnectionString).not.toHaveBeenCalled();
    });
  });
});
