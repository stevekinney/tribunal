import type { Endpoints } from '@octokit/types';
import type { CacheOperations } from '@tribunal/github/context';
import { cachedRead, type CachedReadOptions } from '@tribunal/github/core/github-read-client';
import { requirePolicy } from '@tribunal/github/core/cache-policy';
import { CACHE_KEYS } from '@tribunal/github/cache/keys';

type UserInstallation =
  Endpoints['GET /user/installations']['response']['data']['installations'][number];

export interface UserInstallationClient {
  request(
    endpoint: 'GET /user/installations',
    options: { per_page: number; page: number },
  ): Promise<{ data: { installations: UserInstallation[] } }>;
}

async function fetchAllUserInstallations(
  octokit: UserInstallationClient,
): Promise<UserInstallation[]> {
  const installations: UserInstallation[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.request('GET /user/installations', {
      per_page: 100,
      page,
    });

    installations.push(...data.installations);

    if (data.installations.length < 100) break;
    page += 1;
  }

  return installations;
}

/**
 * Lists every GitHub App installation the given user's own OAuth token can
 * see, via `cachedRead` (per `.claude/rules/github-api.md`) under the
 * `list-user-installations` policy — a short 30s TTL, since this result
 * backs `userCanAccessRepository`, an authorization check, not just display
 * copy (see the policy registration in `core/cache-policy.ts`).
 *
 * Pass `{ bypass: true }` for write-then-read call sites — e.g. right after a
 * user completes the GitHub App install flow — where a stale cached list
 * would incorrectly reject an installation that was just granted.
 */
export async function listUserInstallations(
  cache: CacheOperations,
  userId: number,
  octokit: UserInstallationClient,
  options: CachedReadOptions = {},
): Promise<UserInstallation[]> {
  const policy = requirePolicy('list-user-installations');
  const { value } = await cachedRead(
    cache,
    policy,
    async () => ({ data: await fetchAllUserInstallations(octokit) }),
    [userId],
    options,
  );
  return value;
}

/**
 * Clear the cached installation list for a single user. Callers invalidate
 * this after anything that changes which GitHub account/token backs a
 * user's installations — most importantly reconnecting GitHub OAuth with a
 * different account, where the 30s TTL would otherwise let the previous
 * account's installations (and the repositories they authorize) leak
 * through for up to 30 seconds after the switch.
 */
export async function invalidateUserInstallationsCache(
  cache: CacheOperations,
  userId: number,
): Promise<void> {
  await cache.deleteCache(CACHE_KEYS.GITHUB_USER_INSTALLATIONS(userId));
}

export function getSingleInstallationConfigurationUrl(
  installations: UserInstallation[],
  applicationSlug: string,
): string | null {
  const matchingInstallationUrls = installations
    .filter((installation) => installation.app_slug === applicationSlug)
    .map((installation) => installation.html_url)
    .filter((url): url is string => Boolean(url));

  return matchingInstallationUrls.length === 1 ? matchingInstallationUrls[0] : null;
}

export function userHasInstallationAccess(
  installations: UserInstallation[],
  installationId: number,
): boolean {
  return installations.some((installation) => installation.id === installationId);
}
