import { eq } from 'drizzle-orm';
import type {
  OAuthIdentity,
  ResolveIdentityBinding,
  ResolveUserProfile,
} from '@lostgradient/mcp/oauth';
import type { McpUserProfile } from '@lostgradient/mcp';
import { user } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { isDevBypassNeonAuthUserId } from '$lib/server/auth/dev-auth-bypass-flag';
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
 *   `authHandle` from a real Neon Auth session). It deliberately does **not**
 *   prime the dev auth bypass's synthetic user — a bypass user must never own an
 *   OAuth grant on the mounted surface (TRI-45) — so `identityFromUser` below
 *   maps only genuine sessions.
 * - `resolveIdentityBinding(request)` re-resolves from the raw request cookie
 *   for the library's OAuth handlers, which receive a `Request` rather than a
 *   SvelteKit event.
 * - `resolveUserProfile(subjectId)` refuses a synthetic bypass user outright, so
 *   even a token minted for one before the priming fix (e.g. on a tunnelled dev
 *   database) cannot authenticate a request or render consent.
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
      const raw = part.slice(separator + 1).trim();
      // A malformed percent-encoding must not throw a URIError out of an
      // unauthenticated request; fall back to the raw value, which then fails
      // token validation and resolves to null like any other bad cookie.
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
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
 *
 * A synthetic bypass user (either `dev-bypass:` local mode or `dev-github:`
 * GitHub mode) is refused: it is never a valid OAuth subject. The mount no
 * longer primes the bypass identity (TRI-45), but a token minted for a bypass
 * user before that fix — on a tunnelled dev database, say — would still carry
 * that user's id as its subject. Refusing it here makes the library treat the
 * token as invalid (an unresolved profile is a 401 on `/mcp` and a consent error
 * on `/oauth/authorize`), closing the persisted-credential path for synthetic
 * users too. GitHub mode can also reuse a real account whose genuine Neon
 * subject carries no bypass prefix; those are addressed by revocation (TRI-121).
 */
export const resolveUserProfile: ResolveUserProfile = async (subjectId) => {
  if (!/^[1-9][0-9]*$/.test(subjectId)) return null;
  const id = Number(subjectId);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) return null;
  const [row] = await db.select().from(user).where(eq(user.id, id));
  if (!row) return null;
  if (isDevBypassNeonAuthUserId(row.neonAuthUserId)) return null;
  return profileFromUser(row);
};
