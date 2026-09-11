import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { setCache } from '$lib/server/redis';
import { probeDatabase } from './health-database';
import { createWebHealthResponse } from './health-response';
import { enforceHealthProbeRateLimit } from './health-rate-limit';

export async function GET({ getClientAddress }: RequestEvent): Promise<Response> {
  const rateLimited = await enforceHealthProbeRateLimit(getClientAddress());
  if (rateLimited) return rateLimited;

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
