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
});
