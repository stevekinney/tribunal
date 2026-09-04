/**
 * Flat-model repository resolution for the authenticated user.
 *
 * The target architecture is flat:
 *   user -> github_installation -> github_installation_repository -> repository
 *
 * A user "has" a repository when:
 *   1. They can access the GitHub App installation (verified live against the
 *      user's GitHub OAuth token via `GET /user/installations`), and
 *   2. We have an active link row in `github_installation_repository` joining
 *      that installation to a `repository` record.
 *
 * Resolving the installation set from the user's live GitHub token (rather than
 * trusting a stored binding) keeps access decisions authoritative: if a user
 * loses access to an installation on GitHub, they immediately stop seeing its
 * repositories here.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/database';
import {
  githubInstallation,
  githubInstallationRepository,
  repository,
  type Repository,
} from '@tribunal/database/schema';
import { getUserOctokit } from '$lib/server/github/user-oauth';
import { listUserInstallations } from '$lib/server/github/user-installations';
import { markGitHubTokenInvalid } from '$lib/server/github/access';
import { githubContext } from '$lib/server/github-context';

/**
 * Detect an Octokit 401. Octokit's `RequestError` carries a numeric `status`,
 * so a 401 from `GET /user/installations` means the stored OAuth token was
 * revoked or has expired — not a transient outage.
 */
function isUnauthorizedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401;
}

function isForbiddenError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 403;
}

function shouldUseDevGitHubBypassRepositories(): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    env.DEV_AUTH_BYPASS === '1' &&
    env.DEV_AUTH_BYPASS_MODE === 'github'
  );
}

/** A repository the user can access, paired with its resolving installation. */
export interface UserRepository {
  repository: Repository;
  installation: {
    installationId: number;
    accountLogin: string;
    accountAvatarUrl: string | null;
  };
}

export interface UserRepositoryInstallation {
  installationId: number;
  accountLogin: string;
  accountAvatarUrl: string | null;
}

type LiveUserInstallation = Awaited<ReturnType<typeof listUserInstallations>>[number];

function getLiveInstallationAccountLogin(installation: LiveUserInstallation): string {
  const { account } = installation;
  if (!account) return `installation-${installation.id}`;
  if ('login' in account) return account.login;
  return account.slug ?? account.name ?? `installation-${installation.id}`;
}

/** Why repository resolution could not produce a list. */
export type UserRepositoriesError = 'no_github_token' | 'github_unavailable';

export type UserRepositoriesResult =
  | { ok: true; repositories: UserRepository[]; installations: UserRepositoryInstallation[] }
  | { ok: false; error: UserRepositoriesError; message: string };

/**
 * List every repository the given user can reach through their GitHub App
 * installations.
 *
 * Returns an empty `repositories` array (with `ok: true`) when the user has a
 * valid GitHub connection but no installations or no synced repositories — the
 * caller renders an empty state and a prompt to connect the app.
 */
/**
 * How a caller wants a revoked GitHub token handled.
 *
 * The default records the revocation, which is what every interactive route
 * wants: the next request then prompts for a reconnect instead of re-using a
 * dead token. A read-only caller passes `recordTokenInvalidation: false` — see
 * the MCP readers, whose tools are advertised `readOnlyHint: true` and must
 * not write to `oauth_connection` as a side effect of answering a question.
 */
export type RepositoryResolutionOptions = {
  recordTokenInvalidation?: boolean;
};

/**
 * Which of the user's GitHub App installations they can currently reach,
 * resolved live from GitHub (or, in local/dev-bypass paths, deferred to the
 * caller's own database lookup).
 *
 * This is the piece that both {@link getRepositoriesForUser} (the full-set
 * list) and {@link resolveAuthorizedInstallationId} (the single-repository
 * lookup) share, so that a revoked installation fails both paths identically
 * — the narrow path is not allowed to become a second, divergent source of
 * truth for "which installations can this user reach".
 */
type LiveInstallationResolution =
  | { kind: 'local' }
  | { kind: 'live'; installationIds: number[]; liveInstallations: UserRepositoryInstallation[] }
  | { kind: 'error'; error: UserRepositoriesError; message: string };

async function resolveLiveInstallationSet(
  userId: number,
  options: RepositoryResolutionOptions,
): Promise<LiveInstallationResolution> {
  if (env.NODE_ENV !== 'production' && env.E2E_TEST_MODE === '1' && env.E2E_TEST_SECRET) {
    return { kind: 'local' };
  }

  const octokitResult = await getUserOctokit(userId);
  if (!octokitResult.ok) {
    if (shouldUseDevGitHubBypassRepositories()) {
      return { kind: 'local' };
    }

    // Token problems (missing/expired/invalid) all collapse to "connect GitHub".
    return { kind: 'error', error: 'no_github_token', message: octokitResult.message };
  }

  try {
    const installations = await listUserInstallations(
      githubContext.cache,
      userId,
      octokitResult.octokit,
    );
    const applicationSlug = env.GITHUB_APP_NAME;
    const applicationInstallations = applicationSlug
      ? installations.filter((installation) => installation.app_slug === applicationSlug)
      : [];

    const installationIds = applicationInstallations.map((installation) => installation.id);
    const liveInstallations = applicationInstallations.map((installation) => ({
      installationId: installation.id,
      accountLogin: getLiveInstallationAccountLogin(installation),
      accountAvatarUrl: installation.account?.avatar_url ?? null,
    }));

    return { kind: 'live', installationIds, liveInstallations };
  } catch (error) {
    console.error('Failed to list GitHub installations for user', userId, error);
    if (shouldUseDevGitHubBypassRepositories() && isForbiddenError(error)) {
      return { kind: 'local' };
    }

    if (isUnauthorizedError(error)) {
      // The stored OAuth token was revoked or expired. Persist that fact so the
      // next request returns `no_github_token` (a reconnect prompt) instead of
      // re-using the dead token and repeating this 401 on every load. Mirrors
      // the invalid-token handling in access.ts.
      //
      // A read-only caller opts out: the revocation is GitHub's fact rather
      // than this request's, and an interactive route will record it on the
      // user's next page load either way. What matters is that a tool
      // advertised as read-only does not write.
      if (options.recordTokenInvalidation !== false) {
        await markGitHubTokenInvalid(userId);
      }
      return {
        kind: 'error',
        error: 'no_github_token',
        message: 'Your GitHub connection is no longer valid. Reconnect GitHub to continue.',
      };
    }
    return {
      kind: 'error',
      error: 'github_unavailable',
      message: 'Could not reach GitHub to list your installations. Please try again.',
    };
  }
}

export async function getRepositoriesForUser(
  userId: number,
  options: RepositoryResolutionOptions = {},
): Promise<UserRepositoriesResult> {
  const resolution = await resolveLiveInstallationSet(userId, options);

  if (resolution.kind === 'local') {
    return getLocalRepositoriesForUser(userId);
  }

  if (resolution.kind === 'error') {
    return { ok: false, error: resolution.error, message: resolution.message };
  }

  const { installationIds, liveInstallations } = resolution;

  if (installationIds.length === 0) {
    return { ok: true, repositories: [], installations: [] };
  }

  const installationRows = await db
    .select({
      installationId: githubInstallation.installationId,
      accountLogin: githubInstallation.accountLogin,
      accountAvatarUrl: githubInstallation.accountAvatarUrl,
    })
    .from(githubInstallation)
    .where(
      and(
        inArray(githubInstallation.installationId, installationIds),
        eq(githubInstallation.status, 'active'),
      ),
    );

  const installationsById = new Map<number, UserRepositoryInstallation>();
  for (const installation of liveInstallations) {
    installationsById.set(installation.installationId, installation);
  }

  for (const installation of installationRows) {
    installationsById.set(installation.installationId, installation);
  }

  const installations = Array.from(installationsById.values()).sort((a, b) => {
    if (a.accountLogin === b.accountLogin) return 0;
    return a.accountLogin < b.accountLogin ? -1 : 1;
  });

  // Join our flat model: active installation -> active link -> repository.
  const rows = await db
    .select({
      repository,
      installationId: githubInstallation.installationId,
      accountLogin: githubInstallation.accountLogin,
      accountAvatarUrl: githubInstallation.accountAvatarUrl,
    })
    .from(githubInstallation)
    .innerJoin(
      githubInstallationRepository,
      eq(githubInstallationRepository.installationId, githubInstallation.installationId),
    )
    .innerJoin(repository, eq(repository.id, githubInstallationRepository.repositoryId))
    .where(
      and(
        inArray(githubInstallation.installationId, installationIds),
        eq(githubInstallation.status, 'active'),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    // Ordered so the dedup below is deterministic. Without it the row the
    // database happened to return first decides which installation a caller
    // reads through — and since TRI-111 that choice also decides which
    // credential is used and which cache partition is written, so it must not
    // vary between requests.
    .orderBy(
      desc(githubInstallationRepository.addedAt),
      desc(githubInstallationRepository.installationId),
    );

  // Deduplicate by repository ID. A repository can carry active links for more
  // than one installation — a transfer that leaves the previous organization's
  // link behind is the ordinary way — so this is a real case, not a defensive
  // guard. When a caller is reachable through both, the most recently linked
  // installation wins; both are legitimately theirs, and the tie is broken
  // consistently rather than by row order.
  const seen = new Set<number>();
  const repositories: UserRepository[] = [];
  for (const row of rows) {
    if (seen.has(row.repository.id)) continue;
    seen.add(row.repository.id);
    repositories.push({
      repository: row.repository,
      installation: {
        installationId: row.installationId,
        accountLogin: row.accountLogin,
        accountAvatarUrl: row.accountAvatarUrl,
      },
    });
  }

  // Stable, deterministic ordering: owner then name.
  repositories.sort((a, b) => {
    if (a.repository.owner !== b.repository.owner) {
      return a.repository.owner < b.repository.owner ? -1 : 1;
    }
    if (a.repository.name === b.repository.name) return 0;
    return a.repository.name < b.repository.name ? -1 : 1;
  });

  return { ok: true, repositories, installations };
}

async function getLocalRepositoriesForUser(userId: number): Promise<UserRepositoriesResult> {
  const rows = await db
    .select({
      repository,
      installationId: githubInstallation.installationId,
      accountLogin: githubInstallation.accountLogin,
      accountAvatarUrl: githubInstallation.accountAvatarUrl,
    })
    .from(githubInstallation)
    .innerJoin(
      githubInstallationRepository,
      eq(githubInstallationRepository.installationId, githubInstallation.installationId),
    )
    .innerJoin(repository, eq(repository.id, githubInstallationRepository.repositoryId))
    .where(
      and(
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.status, 'active'),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    // Same reason as the live path above: the dedup below picks the first row
    // per repository, and that choice now determines which credential and
    // cache partition a caller gets. Order it rather than inherit row order.
    .orderBy(
      desc(githubInstallationRepository.addedAt),
      desc(githubInstallationRepository.installationId),
    );

  const installationMap = new Map<number, UserRepositoryInstallation>();
  const repositories: UserRepository[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    installationMap.set(row.installationId, {
      installationId: row.installationId,
      accountLogin: row.accountLogin,
      accountAvatarUrl: row.accountAvatarUrl,
    });

    if (seen.has(row.repository.id)) continue;
    seen.add(row.repository.id);
    repositories.push({
      repository: row.repository,
      installation: {
        installationId: row.installationId,
        accountLogin: row.accountLogin,
        accountAvatarUrl: row.accountAvatarUrl,
      },
    });
  }

  repositories.sort((a, b) => {
    if (a.repository.owner !== b.repository.owner) {
      return a.repository.owner < b.repository.owner ? -1 : 1;
    }
    if (a.repository.name === b.repository.name) return 0;
    return a.repository.name < b.repository.name ? -1 : 1;
  });

  const installations = Array.from(installationMap.values()).sort((a, b) => {
    if (a.accountLogin === b.accountLogin) return 0;
    return a.accountLogin < b.accountLogin ? -1 : 1;
  });

  return { ok: true, repositories, installations };
}

/**
 * Resolve one repository's authorizing installation for a caller whose
 * live installation set could not be resolved from GitHub (dev/E2E local
 * bypass), by trusting the stored `github_installation.user_id` binding
 * instead of a live token.
 *
 * Selects only `installation_id` — never the `repository` table. A matching
 * `github_installation_repository` row is sufficient proof the repository
 * exists, because `github_installation_repository.repository_id` carries
 * `onDelete: 'cascade'` to `repository.id`; joining `repository` here would
 * only re-derive an invariant the foreign key already enforces.
 *
 * Ordered `desc(addedAt), desc(installationId)` and capped to one row for the
 * same reason {@link getRepositoriesForUser}'s full-set join is: a repository
 * can carry active links to more than one of the caller's own installations
 * (an org transfer that leaves the old link active is the ordinary case), and
 * since TRI-111 that choice also decides which credential and cache
 * partition a caller reads through. This ordering must match the full-set
 * path's dedup exactly, or the narrow and wide paths could resolve the same
 * repository to two different installations for the same caller.
 *
 * Exported (like `selectStoredPullRequestState` in the pull request reader)
 * only so a test can assert against its generated SQL rather than a call
 * result — a value-level assertion would pass just as well against a query
 * that joined and projected the whole repository set.
 */
export function selectLocalAuthorizedInstallationId(userId: number, repositoryId: number) {
  return db
    .select({ installationId: githubInstallationRepository.installationId })
    .from(githubInstallationRepository)
    .innerJoin(
      githubInstallation,
      eq(githubInstallation.installationId, githubInstallationRepository.installationId),
    )
    .where(
      and(
        eq(githubInstallationRepository.repositoryId, repositoryId),
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.status, 'active'),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    .orderBy(
      desc(githubInstallationRepository.addedAt),
      desc(githubInstallationRepository.installationId),
    )
    .limit(1);
}

/**
 * Resolve one repository's authorizing installation against the caller's
 * LIVE installation set (`installationIds`, just resolved from GitHub).
 *
 * Same shape and same ordering rationale as
 * {@link selectLocalAuthorizedInstallationId} above, but gated by
 * `inArray(installationId, installationIds)` — the caller's live GitHub
 * membership — rather than the stored `github_installation.user_id` binding.
 * This is what keeps the narrow path authoritative: it never joins or reads
 * the `repository` table, and it never trusts a stored
 * `repository.installationId` alone, only an active link into an
 * installation GitHub, right now, says this user can reach.
 */
export function selectLiveAuthorizedInstallationId(
  repositoryId: number,
  installationIds: number[],
) {
  return db
    .select({ installationId: githubInstallationRepository.installationId })
    .from(githubInstallationRepository)
    .innerJoin(
      githubInstallation,
      eq(githubInstallation.installationId, githubInstallationRepository.installationId),
    )
    .where(
      and(
        eq(githubInstallationRepository.repositoryId, repositoryId),
        inArray(githubInstallationRepository.installationId, installationIds),
        eq(githubInstallation.status, 'active'),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    .orderBy(
      desc(githubInstallationRepository.addedAt),
      desc(githubInstallationRepository.installationId),
    )
    .limit(1);
}

/**
 * Authorize a repository read **and** report which installation granted it.
 *
 * Resolves the same live installation set {@link getRepositoriesForUser}
 * does — so a revoked installation fails this immediately, just as it does
 * for the full list — but then issues a single `repositoryId`-scoped query
 * against `github_installation_repository` joined only to
 * `github_installation`. It never reads or projects the caller's full
 * repository set: a point lookup no longer pays for every repository the
 * caller can reach just to authorize one.
 *
 * Prefer this on any path that goes on to call GitHub: it is the only
 * repository-scoped resolver that reports *which* installation admitted the
 * caller, rather than a bare boolean. The only other repository-scoped
 * resolver (`getInstallationForRepository`) takes no user and picks the
 * repository's most recently added active link — irrespective of whether
 * this caller can reach it — so when a repository carries links to two
 * installations, that answer can differ from this one and hand a caller a
 * client for an installation they were never authorized through.
 *
 * `null` means the repository is not in the caller's reachable set — either
 * because they genuinely cannot reach it, or because the set could not be
 * determined (a GitHub outage while listing their installations). Those two
 * are deliberately not distinguished, matching what `userCanAccessRepository`
 * has always reported as `false`, and callers keep treating both as
 * not-found. Telling an unauthorized caller that a repository exists but is
 * temporarily unreachable would be its own small disclosure; distinguishing
 * them for authorized callers would need a third state this signature does
 * not have.
 */
export async function resolveAuthorizedInstallationId(
  userId: number,
  repositoryId: number,
  options: RepositoryResolutionOptions = {},
): Promise<number | null> {
  const resolution = await resolveLiveInstallationSet(userId, options);

  if (resolution.kind === 'error') return null;

  if (resolution.kind === 'local') {
    const [row] = await selectLocalAuthorizedInstallationId(userId, repositoryId);
    return row?.installationId ?? null;
  }

  if (resolution.installationIds.length === 0) return null;

  const [row] = await selectLiveAuthorizedInstallationId(repositoryId, resolution.installationIds);
  return row?.installationId ?? null;
}

/**
 * Confirm the user can reach a single repository through one of their GitHub App
 * installations. Used to authorize repository-scoped routes (e.g. pull
 * requests) without trusting the URL alone.
 *
 * A thin wrapper over {@link resolveAuthorizedInstallationId} — it discards
 * which installation granted access, keeping only whether one did — so it
 * inherits that function's narrow, single-repository query path rather than
 * resolving (and discarding) the caller's entire repository set.
 */
export async function userCanAccessRepository(
  userId: number,
  repositoryId: number,
  options: RepositoryResolutionOptions = {},
): Promise<boolean> {
  return (await resolveAuthorizedInstallationId(userId, repositoryId, options)) !== null;
}
