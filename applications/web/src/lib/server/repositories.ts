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
import { and, eq, inArray } from 'drizzle-orm';
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

/**
 * Detect an Octokit 401. Octokit's `RequestError` carries a numeric `status`,
 * so a 401 from `GET /user/installations` means the stored OAuth token was
 * revoked or has expired — not a transient outage.
 */
function isUnauthorizedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401;
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
export async function getRepositoriesForUser(userId: number): Promise<UserRepositoriesResult> {
  if (env.NODE_ENV !== 'production' && env.E2E_TEST_MODE === '1' && env.E2E_TEST_SECRET) {
    return getE2ERepositoriesForUser(userId);
  }

  const octokitResult = await getUserOctokit(userId);
  if (!octokitResult.ok) {
    // Token problems (missing/expired/invalid) all collapse to "connect GitHub".
    return {
      ok: false,
      error: 'no_github_token',
      message: octokitResult.message,
    };
  }

  let installationIds: number[];
  let liveInstallations: UserRepositoryInstallation[];
  try {
    const installations = await listUserInstallations(octokitResult.octokit);
    const applicationSlug = env.GITHUB_APP_NAME;
    const applicationInstallations = applicationSlug
      ? installations.filter((installation) => installation.app_slug === applicationSlug)
      : [];

    installationIds = applicationInstallations.map((installation) => installation.id);
    liveInstallations = applicationInstallations.map((installation) => ({
      installationId: installation.id,
      accountLogin: getLiveInstallationAccountLogin(installation),
      accountAvatarUrl: installation.account?.avatar_url ?? null,
    }));
  } catch (error) {
    console.error('Failed to list GitHub installations for user', userId, error);
    if (isUnauthorizedError(error)) {
      // The stored OAuth token was revoked or expired. Persist that fact so the
      // next request returns `no_github_token` (a reconnect prompt) instead of
      // re-using the dead token and repeating this 401 on every load. Mirrors
      // the invalid-token handling in access.ts.
      await markGitHubTokenInvalid(userId);
      return {
        ok: false,
        error: 'no_github_token',
        message: 'Your GitHub connection is no longer valid. Reconnect GitHub to continue.',
      };
    }
    return {
      ok: false,
      error: 'github_unavailable',
      message: 'Could not reach GitHub to list your installations. Please try again.',
    };
  }

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
    );

  // Deduplicate by repository ID — a repo can only belong to one installation,
  // but guard against duplicate link rows defensively.
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

async function getE2ERepositoriesForUser(userId: number): Promise<UserRepositoriesResult> {
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
 * Confirm the user can reach a single repository through one of their GitHub App
 * installations. Used to authorize repository-scoped routes (e.g. pull
 * requests) without trusting the URL alone.
 */
export async function userCanAccessRepository(
  userId: number,
  repositoryId: number,
): Promise<boolean> {
  const result = await getRepositoriesForUser(userId);
  if (!result.ok) return false;
  return result.repositories.some((entry) => entry.repository.id === repositoryId);
}
