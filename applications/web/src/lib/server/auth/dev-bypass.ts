/**
 * Development-only authentication bypass.
 *
 * OAuth cannot complete inside sandboxed preview iframes (the Neon Auth redirect
 * targets an external host the sandbox refuses to follow), which makes the
 * authenticated UI unreachable there. When armed, this handle auto-logs-in as a
 * fixed local user so every authenticated route "just works" with no click —
 * purely for iterating on UI in development.
 *
 * Arming requires BOTH:
 *   - a real dev runtime (`dev` from `$app/environment`, false in prod builds), and
 *   - an explicit opt-in flag: `DEV_AUTH_BYPASS=1`.
 *
 * A startup guard hard-fails if the flag is ever armed outside dev, mirroring
 * `assertE2EModeNotInProduction` for the `/__e2e__/*` backdoor. It never seeds a
 * GitHub token, so GitHub-backed pages render their connect/empty states.
 */
import type { Handle } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { user as userTable } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import type { AuthenticatedApplicationUser, NeonSession } from './neon-session';

const BYPASS_FLAG = '1';
const DEFAULT_BYPASS_USERNAME = 'dev';

const userColumns = {
  id: userTable.id,
  username: userTable.username,
  name: userTable.name,
  avatarUrl: userTable.avatarUrl,
  email: userTable.email,
  isPlatformAdministrator: userTable.isPlatformAdministrator,
} as const;

/**
 * Whether the dev auth bypass is armed. False in any production runtime because
 * `dev` is false there, regardless of the flag.
 */
export function isDevAuthBypassEnabled(): boolean {
  return dev && env.DEV_AUTH_BYPASS === BYPASS_FLAG;
}

/**
 * Fail loudly at startup if the bypass flag is armed in a non-dev runtime. A
 * leaked `DEV_AUTH_BYPASS=1` would otherwise be a silent authentication bypass.
 *
 * @throws if `DEV_AUTH_BYPASS=1` outside a dev runtime.
 */
export function assertDevAuthBypassNotInProduction(environment: {
  dev: boolean;
  DEV_AUTH_BYPASS?: string;
}): void {
  if (!environment.dev && environment.DEV_AUTH_BYPASS === BYPASS_FLAG) {
    throw new Error(
      'Refusing to start: DEV_AUTH_BYPASS=1 is set outside a development runtime. ' +
        'The dev auth bypass auto-logs-in a local user and must never be reachable in production. ' +
        'Unset DEV_AUTH_BYPASS in this deployment.',
    );
  }
}

// Startup guard: an armed flag in a real (non-dev) server runtime is fatal.
// Skipped during `vite build` prerender, which evaluates this module.
if (!building) {
  assertDevAuthBypassNotInProduction({ dev, DEV_AUTH_BYPASS: env.DEV_AUTH_BYPASS });
}

function bypassUsername(): string {
  const configured = env.DEV_AUTH_BYPASS_USER?.trim().toLowerCase();
  return configured && configured.length > 0 ? configured : DEFAULT_BYPASS_USERNAME;
}

/**
 * Resolve (creating on first use) the local user the bypass logs in as. Seeding
 * a real row means write actions like watching a repository don't fail on
 * foreign keys, matching how the E2E flow seeds a user.
 */
async function resolveBypassUser(username: string): Promise<AuthenticatedApplicationUser> {
  const [existing] = await db
    .select(userColumns)
    .from(userTable)
    .where(sql`lower(${userTable.username}) = ${username}`)
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(userTable)
    .values({
      username,
      // Namespaced so it can never collide with a real Neon Auth subject.
      neonAuthUserId: `dev-bypass:${username}`,
      name: 'Dev User',
    })
    .returning(userColumns);

  return created;
}

/**
 * SvelteKit handle that auto-logs-in the bypass user when armed. A no-op
 * pass-through otherwise, and deliberately inert under E2E mode so the two auth
 * swaps never collide. Placed after `authHandle` in the sequence so it wins.
 */
export const devAuthBypassHandle: Handle = async ({ event, resolve }) => {
  if (!isDevAuthBypassEnabled() || env.E2E_TEST_MODE === '1') {
    return resolve(event);
  }

  const user = await resolveBypassUser(bypassUsername());
  const neonSession: NeonSession = {
    neonAuthUserId: `dev-bypass:${user.username}`,
    // Far-future so nothing treats the synthetic session as expired.
    expiresAt: new Date('2999-01-01T00:00:00.000Z'),
  };

  event.locals.user = user;
  event.locals.neonSession = neonSession;

  return resolve(event);
};
