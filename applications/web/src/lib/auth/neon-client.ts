import { env } from '$env/dynamic/public';
import { createAuthClient } from '@neondatabase/neon-js/auth';

export function getNeonAuthClient() {
  const authUrl = env.PUBLIC_NEON_AUTH_URL;
  if (!authUrl) {
    throw new Error('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
  }

  return createAuthClient(authUrl);
}
