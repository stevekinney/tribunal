import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * True when both Neon Auth environment variables are present.
 *
 * GitHub sign-in cannot start without the public auth URL (used by the browser
 * client) and the private base URL (used server-side to mint the local session),
 * so the sign-in pages surface a configuration error instead of a dead button
 * when either is missing.
 */
export function isNeonAuthConfigured(): boolean {
  return Boolean(publicEnv.PUBLIC_NEON_AUTH_URL && privateEnv.NEON_AUTH_BASE_URL);
}
