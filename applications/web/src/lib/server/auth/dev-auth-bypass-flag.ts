import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/** The literal value that arms the dev auth bypass. */
export const DEV_AUTH_BYPASS_FLAG = '1';

/**
 * Prefixes of the `neonAuthUserId` on the synthetic users the bypass seeds:
 * `dev-bypass:<username>` (local mode) and `dev-github:<githubId>` (GitHub
 * mode). Namespaced so a bypass row can never collide with a real Neon Auth
 * subject, and so consumers — the bypass itself, and the OAuth profile seam that
 * must refuse to resolve a bypass user as an OAuth subject — can recognize one
 * from its stored identity alone.
 */
export const DEV_BYPASS_NEON_AUTH_ID_PREFIX = 'dev-bypass:';
export const DEV_GITHUB_BYPASS_NEON_AUTH_ID_PREFIX = 'dev-github:';

/**
 * Whether a `neonAuthUserId` belongs to a synthetic user either bypass mode
 * seeds. Such a user is never a legitimate OAuth subject: it only ever arises
 * from the dev auth bypass, never from real Neon Auth. Note this covers the
 * synthetic rows only — GitHub mode can also reuse a real account (a GitHub
 * connection or installation owner) whose genuine Neon subject carries no
 * bypass prefix; credentials minted for those before the priming fix are
 * addressed by revocation (TRI-121), not this predicate.
 */
export function isDevBypassNeonAuthUserId(neonAuthUserId: string | null | undefined): boolean {
  return (
    !!neonAuthUserId &&
    (neonAuthUserId.startsWith(DEV_BYPASS_NEON_AUTH_ID_PREFIX) ||
      neonAuthUserId.startsWith(DEV_GITHUB_BYPASS_NEON_AUTH_ID_PREFIX))
  );
}

/**
 * Whether the dev auth bypass is effectively active. False in any production
 * runtime because `dev` is false there, and false under E2E mode: the E2E
 * handle supplies its own authenticated user and `devAuthBypassHandle` is
 * deliberately inert, so the two auth swaps never collide. Consumers that gate
 * on the bypass (the MCP identity handle, the conformance surface) want this
 * "effectively active" meaning, not merely "the flag is set".
 *
 * Extracted into its own module — no database import, no module-load startup
 * guard — so request-path consumers (`mount-hooks.ts`, `conformance-surface.ts`)
 * can read the flag without pulling `dev-bypass.ts`'s heavier load graph
 * (`building`, the process-startup assertion, and the user-seeding database
 * access) into every test that mocks `$app/environment`.
 */
export function isDevAuthBypassEnabled(): boolean {
  return dev && env.DEV_AUTH_BYPASS === DEV_AUTH_BYPASS_FLAG && env.E2E_TEST_MODE !== '1';
}
