import { eq } from 'drizzle-orm';
import type {
  OAuthIdentity,
  ResolveIdentityBinding,
  ResolveUserProfile,
} from '@lostgradient/mcp/oauth';
import type { McpUserProfile } from '@lostgradient/mcp';
import { user } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import {
  neonAuthTokenCookieName,
  validateNeonSessionFromToken,
  type AuthenticatedApplicationUser,
} from '$lib/server/auth/neon-session';

/**
 * The OAuth identity seam.
 *
 * Two paths resolve the same `OAuthIdentity`, and they must agree:
 *
 * - The mount requires an earlier handle to call `primeSvelteKitMcpIdentity`
 *   for every request. That handle reads `event.locals.user` (populated by
 *   `authHandle`, and overridden by `devAuthBypassHandle` in preview), so it
 *   works under both real Neon Auth and the dev bypass. `identityFromUser`
 *   below is the shared mapping it uses.
 * - `resolveIdentityBinding(request)` re-resolves from the raw request cookie
 *   for the library's OAuth handlers, which receive a `Request` rather than a
 *   SvelteKit event.
 *
 * The OAuth **subject** is Tribunal's integer `user.id` rendered as a string —
 * not the Neon `sub` — because the MCP tool handlers resolve `context.userId`
 * back to an integer via `resolveTribunalUserId`. The Neon `sub` is only the
 * lookup key on the way in. The **consent binding** keys off the same user id
 * (per `documentation/mcp-consent-session.md`: bind to the user alone), so a
 * consent granted by a user matches that user at token exchange.
 */

const CONSENT_BINDING_PREFIX = 'user:';

/** Maps an authenticated Tribunal user to the engine's `OAuthIdentity`. */
export function identityFromUser(applicationUser: AuthenticatedApplicationUser): OAuthIdentity {
  return {
    subjectId: String(applicationUser.id),
    consentBinding: `${CONSENT_BINDING_PREFIX}${applicationUser.id}`,
  };
}

/** Maps an authenticated Tribunal user to the engine's `McpUserProfile`. */
export function profileFromUser(applicationUser: AuthenticatedApplicationUser): McpUserProfile {
  return {
    id: String(applicationUser.id),
    email: applicationUser.email ?? '',
    name: applicationUser.name ?? applicationUser.username,
    image: applicationUser.avatarUrl,
    role: applicationUser.isPlatformAdministrator ? 'admin' : 'user',
  };
}

/** Reads a single cookie value from a raw request's Cookie header. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

/**
 * Resolves the OAuth identity from the Neon Auth cookie on a raw request.
 * Returns null for an absent, invalid, or unmapped session rather than
 * throwing — the OAuth authorize path treats a null identity as "sign in
 * first", which is the correct behaviour for an unauthenticated browser.
 */
export const resolveIdentityBinding: ResolveIdentityBinding = async (request) => {
  const token = readCookie(request, neonAuthTokenCookieName);
  if (!token) return null;
  try {
    const { user: applicationUser } = await validateNeonSessionFromToken(token);
    return identityFromUser(applicationUser);
  } catch {
    return null;
  }
};

/**
 * Resolves a user profile from the OAuth subject (Tribunal's integer user id
 * as a string). Returns null for a malformed subject or a missing row.
 */
export const resolveUserProfile: ResolveUserProfile = async (subjectId) => {
  if (!/^[1-9][0-9]*$/.test(subjectId)) return null;
  const id = Number(subjectId);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) return null;
  const [row] = await db.select().from(user).where(eq(user.id, id));
  if (!row) return null;
  return profileFromUser(row);
};
