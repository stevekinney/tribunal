import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/** The literal value that arms the dev auth bypass. */
export const DEV_AUTH_BYPASS_FLAG = '1';

/**
 * Whether the dev auth bypass is armed. False in any production runtime because
 * `dev` is false there, regardless of the flag.
 *
 * Extracted into its own module — no database import, no module-load startup
 * guard — so request-path consumers (`mount-hooks.ts`, `conformance-surface.ts`)
 * can read the flag without pulling `dev-bypass.ts`'s heavier load graph
 * (`building`, the process-startup assertion, and the user-seeding database
 * access) into every test that mocks `$app/environment`.
 */
export function isDevAuthBypassEnabled(): boolean {
  return dev && env.DEV_AUTH_BYPASS === DEV_AUTH_BYPASS_FLAG;
}
