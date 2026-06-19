import { Pool, type PoolClient } from '@neondatabase/serverless';
import type { EngineSingletonLease, EngineSingletonLock } from './bootstrap';

const lockKey = 'tribunal-engine-singleton';

export function createPostgresAdvisoryLock(connectionString: string): EngineSingletonLock {
  const pool = new Pool({ connectionString, max: 1 });
  return {
    async acquire() {
      const client = await pool.connect();
      try {
        const result = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
          [lockKey],
        );
        if (result.rows[0]?.acquired !== true) {
          throw new Error('another Tribunal engine already holds the singleton advisory lock');
        }
        return new PostgresAdvisoryLease(pool, client);
      } catch (error) {
        client.release();
        await pool.end();
        throw error;
      }
    },
  };
}

class PostgresAdvisoryLease implements EngineSingletonLease {
  constructor(
    private readonly pool: Pool,
    private readonly client: PoolClient,
  ) {}

  async release(): Promise<void> {
    try {
      await this.client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
    } finally {
      this.client.release();
      await this.pool.end();
    }
  }
}
