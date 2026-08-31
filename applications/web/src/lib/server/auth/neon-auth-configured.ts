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

/** Refuse server startup when the configured identity provider is incomplete. */
export function assertNeonAuthConfigured(): void {
  const missingVariables = [
    !publicEnv.PUBLIC_NEON_AUTH_URL && 'PUBLIC_NEON_AUTH_URL',
    !privateEnv.NEON_AUTH_BASE_URL && 'NEON_AUTH_BASE_URL',
  ].filter((variableName): variableName is string => Boolean(variableName));

  if (missingVariables.length > 0) {
    throw new Error(
      `Refusing to start: Neon Auth is not configured. Missing ${missingVariables.join(', ')}.`,
    );
  }
}
