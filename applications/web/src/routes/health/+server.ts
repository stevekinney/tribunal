import { env } from '$env/dynamic/private';
import { setCache } from '$lib/server/redis';
import { probeDatabase } from './health-database';
import { createWebHealthResponse } from './health-response';

export async function GET(): Promise<Response> {
  return createWebHealthResponse(
    {
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
    },
    {
      database: async () => {
        await probeDatabase(env.DATABASE_URL);
      },
      redis: async () => {
        if (!env.REDIS_URL) return;
        const ok = await setCache('__tribunal_health__', 'ok', 10);
        if (!ok) throw new Error('Redis health write failed');
      },
    },
  );
}
