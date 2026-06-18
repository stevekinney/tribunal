import { env } from '$env/dynamic/private';
import { createWebHealthResponse } from './health-response';

export function GET(): Response {
  return createWebHealthResponse({
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
  });
}
