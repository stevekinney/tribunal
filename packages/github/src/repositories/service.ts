import type { Endpoints } from '@octokit/types';
import { eq, and, desc } from 'drizzle-orm';
import type { Repository } from '@tribunal/database/schema';
import { repository, githubInstallationRepository } from '@tribunal/database/schema';
import { computeRepositoryUri } from '@tribunal/github';
import type { GithubServiceContext } from '../context.js';
import { getInstallationById } from '../installations/records.js';

export { computeRepositoryUri };

/**
 * Lightweight projection of repository metadata used by workflow services.
 * Contains the fields needed for deterministic ID generation and workflow inputs.
 */
export interface RepositoryMetadata {
  id: number;
  owner: string;
  name: string;
  uri: string | null;
  installationId: number | null;
  defaultBranch: string | null;
  commit: string | null;
}

type InstallationRepository =
  Endpoints['GET /installation/repositories']['response']['data']['repositories'][number];

export type RepositorySortField =
  | 'name'
  | 'updated_at'
  | 'created_at'
  | 'pushed_at'
  | 'stargazers_count'
  | 'open_issues_count';
export type SortDirection = 'asc' | 'desc';
export type RepositoryVisibility = 'all' | 'public' | 'private';

export type RepositoryListItem = Pick<
  InstallationRepository,
  | 'id'
  | 'name'
  | 'full_name'
  | 'description'
  | 'private'
  | 'html_url'
  | 'language'
  | 'stargazers_count'
  | 'forks_count'
  | 'open_issues_count'
  | 'default_branch'
  | 'archived'
  | 'fork'
  | 'owner'
  | 'updated_at'
  | 'created_at'
  | 'pushed_at'
> & {
  installationId: number;
};

export interface RepositoryFilterOptions {
  query: string;
  visibility: RepositoryVisibility;
  sort: RepositorySortField;
  direction: SortDirection;
  language: string;
  archived: 'all' | 'true' | 'false';
  fork: 'all' | 'true' | 'false';
  owner: string;
  page: number;
  perPage: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface RepositoryListResult {
  repositories: RepositoryListItem[];
  pagination: PaginatedResult<RepositoryListItem>;
  filters: RepositoryFilterOptions;
  languages: string[];
  owners: string[];
  installations: Array<{
    id: number;
    installationId: number;
    accountLogin: string;
    accountAvatarUrl: string | null;
  }>;
}

const VALID_SORT_FIELDS: RepositorySortField[] = [
  'name',
  'updated_at',
  'created_at',
  'pushed_at',
  'stargazers_count',
  'open_issues_count',
];
const VALID_DIRECTIONS: SortDirection[] = ['asc', 'desc'];
const VALID_VISIBILITY: RepositoryVisibility[] = ['all', 'public', 'private'];

export function parseFilters(url: URL, ownerParam?: string): RepositoryFilterOptions {
  const query = url.searchParams.get('query') ?? '';
  const visibility = (url.searchParams.get('visibility') as RepositoryVisibility) ?? 'all';
  const sort = (url.searchParams.get('sort') as RepositorySortField) ?? 'updated_at';
  const direction = (url.searchParams.get('direction') as SortDirection) ?? 'desc';
  const language = url.searchParams.get('language') ?? '';
  const archived = url.searchParams.get('archived') ?? 'false';
  const fork = url.searchParams.get('fork') ?? 'all';
  const owner = ownerParam ?? url.searchParams.get('owner') ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(10, parseInt(url.searchParams.get('per_page') ?? '30', 10) || 30),
  );

  return {
    query,
    visibility: VALID_VISIBILITY.includes(visibility) ? visibility : 'all',
    sort: VALID_SORT_FIELDS.includes(sort) ? sort : 'updated_at',
    direction: VALID_DIRECTIONS.includes(direction) ? direction : 'desc',
    language,
    archived: archived === 'true' ? 'true' : archived === 'all' ? 'all' : 'false',
    fork: fork === 'true' ? 'true' : fork === 'false' ? 'false' : 'all',
    owner,
    page,
    perPage,
  };
}

export function filterRepositories(
  repos: RepositoryListItem[],
  filters: RepositoryFilterOptions,
): RepositoryListItem[] {
  return repos.filter((repo) => {
    // Owner filter
    if (filters.owner && repo.owner.login.toLowerCase() !== filters.owner.toLowerCase()) {
      return false;
    }

    // Text search
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const matchesName = repo.name.toLowerCase().includes(q);
      const matchesFullName = repo.full_name.toLowerCase().includes(q);
      const matchesDescription = repo.description?.toLowerCase().includes(q) ?? false;
      if (!matchesName && !matchesFullName && !matchesDescription) {
        return false;
      }
    }

    // Visibility filter
    if (filters.visibility === 'public' && repo.private) return false;
    if (filters.visibility === 'private' && !repo.private) return false;

    // Language filter
    if (filters.language && repo.language?.toLowerCase() !== filters.language.toLowerCase()) {
      return false;
    }

    // Archived filter
    if (filters.archived === 'true' && !repo.archived) return false;
    if (filters.archived === 'false' && repo.archived) return false;

    // Fork filter
    if (filters.fork === 'true' && !repo.fork) return false;
    if (filters.fork === 'false' && repo.fork) return false;

    return true;
  });
}

export function sortRepositories(
  repos: RepositoryListItem[],
  sort: RepositorySortField,
  direction: SortDirection,
): RepositoryListItem[] {
  const sorted = [...repos].sort((a, b) => {
    let comparison = 0;

    switch (sort) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'updated_at': {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        comparison = aTime - bTime;
        break;
      }
      case 'created_at': {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        comparison = aTime - bTime;
        break;
      }
      case 'pushed_at': {
        const aTime = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
        const bTime = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
        comparison = aTime - bTime;
        break;
      }
      case 'stargazers_count':
        comparison = a.stargazers_count - b.stargazers_count;
        break;
      case 'open_issues_count':
        comparison = a.open_issues_count - b.open_issues_count;
        break;
    }

    return direction === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

export function paginateRepositories(
  repos: RepositoryListItem[],
  page: number,
  perPage: number,
): PaginatedResult<RepositoryListItem> {
  const start = (page - 1) * perPage;
  const end = start + perPage;
  return {
    items: repos.slice(start, end),
    total: repos.length,
    page,
    perPage,
    totalPages: Math.ceil(repos.length / perPage),
  };
}

// =============================================================================
// Database Repository Management Functions
// =============================================================================

/**
 * Get a repository by its GitHub ID from the database
 */
export async function getRepositoryById(
  context: GithubServiceContext,
  repositoryId: number,
): Promise<Repository | null> {
  const [repo] = await context.db.select().from(repository).where(eq(repository.id, repositoryId));
  return repo ?? null;
}

/**
 * Get a repository by owner and name.
 */
export async function getRepositoryByOwnerAndName(
  context: GithubServiceContext,
  owner: string,
  name: string,
): Promise<Repository | null> {
  const [repo] = await context.db
    .select()
    .from(repository)
    .where(and(eq(repository.owner, owner.toLowerCase()), eq(repository.name, name.toLowerCase())));
  return repo ?? null;
}

/**
 * Get or create a repository record.
 * Used by webhook handlers and action item creation to ensure repository exists.
 * Uses onConflictDoUpdate to handle race conditions atomically.
 */
export async function getOrCreateRepository(
  context: GithubServiceContext,
  id: number,
  owner: string,
  name: string,
  installationId: number | null,
): Promise<Repository> {
  // Use upsert pattern to atomically create or update
  // The repository.id is the primary key
  const [repo] = await context.db
    .insert(repository)
    .values({
      id,
      owner,
      name,
      uri: computeRepositoryUri(owner, name),
      installationId,
    })
    .onConflictDoUpdate({
      target: repository.id,
      set: {
        owner,
        name,
        uri: computeRepositoryUri(owner, name),
        installationId,
      },
    })
    .returning();

  return repo;
}

/**
 * Update repository metadata (owner, name, installationId).
 * Called when repository is renamed or transferred.
 */
export async function updateRepositoryMetadata(
  context: GithubServiceContext,
  id: number,
  owner: string,
  name: string,
  installationId: number | null,
): Promise<void> {
  await context.db
    .update(repository)
    .set({
      owner,
      name,
      uri: computeRepositoryUri(owner, name),
      installationId,
      updatedAt: new Date(),
    })
    .where(eq(repository.id, id));
}

/**
 * Update repository default branch.
 * Called when repository.edited webhook arrives with default_branch change.
 *
 * Also resets `commit` to null because the old SHA belonged to the previous
 * default branch. Without this, the stale SHA would produce the same dedup
 * hash and trick the analysis trigger into thinking the new branch state
 * was already analyzed. The next push event on the new branch will populate
 * the correct SHA.
 *
 * Known limitation: there is a timing window between the branch change and
 * the next push event where `commit` is null. During this window, analyses
 * use `commit: null` in the dedup hash, which means two different repository
 * states (both with null commits) would produce the same hash. In practice
 * this is unlikely because (a) default branch changes are infrequent, and
 * (b) analyses are rarely triggered in the seconds between the branch edit
 * webhook and the subsequent push event. A future improvement could fetch
 * the latest commit SHA from the GitHub API during the branch change.
 */
export async function updateRepositoryDefaultBranch(
  context: GithubServiceContext,
  id: number,
  defaultBranch: string,
): Promise<void> {
  await context.db
    .update(repository)
    .set({
      defaultBranch,
      commit: null,
      updatedAt: new Date(),
    })
    .where(eq(repository.id, id));
}

/**
 * Update repository commit SHA.
 * Called when a push event occurs on the default branch.
 */
export async function updateRepositoryCommit(
  context: GithubServiceContext,
  id: number,
  commit: string,
): Promise<void> {
  await context.db
    .update(repository)
    .set({
      commit,
      updatedAt: new Date(),
    })
    .where(eq(repository.id, id));
}

/**
 * Get all repository IDs for a given GitHub owner (user/org login).
 * Used for cache invalidation when org membership changes.
 *
 * IMPORTANT: This function assumes repository.owner matches the GitHub org/user login.
 * This assumption holds as long as:
 * - repository.owner is updated via updateRepositoryMetadata() on rename/transfer webhooks
 * - repository.owner stores the login (e.g., "acme-corp") not the display name
 *
 * Edge cases where this could fail:
 * - If a webhook for rename/transfer is missed, owner field may be stale
 * - Case sensitivity: GitHub logins are case-insensitive but we store as received
 *
 * For large orgs (>100 repos), this may be expensive. Consider monitoring performance.
 */
export async function getRepositoryIdsByOwner(
  context: GithubServiceContext,
  owner: string,
): Promise<number[]> {
  const results = await context.db
    .select({ id: repository.id })
    .from(repository)
    .where(eq(repository.owner, owner));

  return results.map((r) => r.id);
}

// =============================================================================
// Installation Resolution for Repositories
// =============================================================================

import type { Octokit as OctokitType } from 'octokit';

export type RepositoryInstallationResult =
  | { ok: true; octokit: OctokitType; installationId: number; owner: string; repo: string }
  | { ok: false; error: string; code: 'not_found' | 'no_installation' | 'suspended' | 'error' };

export type InstallationIdResult =
  | { ok: true; installationId: number }
  | { ok: false; error: string; code: 'not_found' | 'no_installation' };

/** Internal result type that includes status-check codes (suspended, error). */
type ValidatedInstallationResult =
  | { ok: true; installationId: number }
  | { ok: false; error: string; code: 'no_installation' | 'suspended' | 'error' };

/**
 * Resolve the installation and Octokit client for a specific repository.
 *
 * This is the primary entry point for GitHub API calls scoped to a repository.
 * Fetches all needed repository columns in a single query, then validates the
 * installation and constructs an authenticated Octokit client.
 *
 * @param context - The GitHub service context
 * @param repositoryId - The database ID of the repository
 * @returns Result containing the Octokit client and repo info, or an error
 */
export async function getInstallationForRepository(
  context: GithubServiceContext,
  repositoryId: number,
): Promise<RepositoryInstallationResult> {
  // 1. Fetch all needed repository columns in a single query
  const [repo] = await context.db
    .select({
      owner: repository.owner,
      name: repository.name,
      installationId: repository.installationId,
    })
    .from(repository)
    .where(eq(repository.id, repositoryId));

  if (!repo) {
    return { ok: false, error: 'Repository not found', code: 'not_found' };
  }

  // 2. Resolve installation ID (link table preferred, fallback to repository column)
  const validatedInstallation = await validateInstallationForRepository(
    context,
    repositoryId,
    repo.installationId,
  );
  if (!validatedInstallation.ok) {
    return validatedInstallation;
  }

  // 3. Get the Octokit client
  const octokit = await context.getInstallationOctokit(validatedInstallation.installationId);
  if (!octokit) {
    return {
      ok: false,
      error: 'Failed to create GitHub client - check app configuration',
      code: 'error',
    };
  }

  return {
    ok: true,
    octokit,
    installationId: validatedInstallation.installationId,
    owner: repo.owner,
    repo: repo.name,
  };
}

/**
 * Lightweight resolver that returns only the installation ID without constructing
 * an Octokit client. Use this when callers only need the installation ID and will
 * pass it to service functions that create their own Octokit internally.
 *
 * Unlike `getInstallationForRepository`, this does NOT check installation status
 * (suspended, inactive). This preserves the original behavior where issue routes
 * could still attempt API calls for suspended installations -- read-only GitHub
 * API calls typically succeed even when our local status is "suspended".
 *
 * When callers already have a `Repository` object (e.g., from `getRepositoryById`),
 * pass `knownInstallationId` to skip the redundant repository query.
 */
export async function getInstallationIdForRepository(
  context: GithubServiceContext,
  repositoryId: number,
  knownInstallationId?: number | null,
): Promise<InstallationIdResult> {
  let fallbackInstallationId: number | null;

  if (knownInstallationId !== undefined) {
    fallbackInstallationId = knownInstallationId;
  } else {
    const [repo] = await context.db
      .select({
        installationId: repository.installationId,
      })
      .from(repository)
      .where(eq(repository.id, repositoryId));

    if (!repo) {
      return { ok: false, error: 'Repository not found', code: 'not_found' };
    }
    fallbackInstallationId = repo.installationId ?? null;
  }

  // Resolve installation ID from link table (preferred) or fallback to repository column.
  // We intentionally skip status validation here -- callers using this function
  // perform read-only operations that should proceed regardless of installation status.
  let installationId = await getInstallationIdFromLinkTable(context, repositoryId);
  if (!installationId) {
    installationId = fallbackInstallationId;
  }

  if (!installationId) {
    return {
      ok: false,
      error: 'Repository has no associated GitHub installation',
      code: 'no_installation',
    };
  }

  const installation = await getInstallationById(context, installationId);
  if (!installation) {
    return { ok: false, error: 'GitHub installation not found', code: 'no_installation' };
  }

  return { ok: true, installationId };
}

/**
 * Shared installation validation: resolves installation ID from the link table
 * (preferred) or falls back to the repository column, then verifies the
 * installation exists and is active.
 */
async function validateInstallationForRepository(
  context: GithubServiceContext,
  repositoryId: number,
  repositoryInstallationId: number | null,
): Promise<ValidatedInstallationResult> {
  let installationId = await getInstallationIdFromLinkTable(context, repositoryId);
  if (!installationId) {
    installationId = repositoryInstallationId ?? null;
  }

  if (!installationId) {
    return {
      ok: false,
      error: 'Repository has no associated GitHub installation',
      code: 'no_installation',
    };
  }

  const installation = await getInstallationById(context, installationId);
  if (!installation) {
    return { ok: false, error: 'GitHub installation not found', code: 'no_installation' };
  }

  if (installation.status === 'suspended') {
    return { ok: false, error: 'GitHub installation is suspended', code: 'suspended' };
  }

  if (installation.status !== 'active') {
    return { ok: false, error: `GitHub installation is ${installation.status}`, code: 'error' };
  }

  return { ok: true, installationId };
}

/**
 * Check the github_installation_repository link table for an active installation link.
 * This is more reliable than repository.installationId which can be null or stale.
 */
async function getInstallationIdFromLinkTable(
  context: GithubServiceContext,
  repositoryId: number,
): Promise<number | null> {
  const [link] = await context.db
    .select({ installationId: githubInstallationRepository.installationId })
    .from(githubInstallationRepository)
    .where(
      and(
        eq(githubInstallationRepository.repositoryId, repositoryId),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    .orderBy(desc(githubInstallationRepository.addedAt))
    .limit(1);

  return link?.installationId ?? null;
}

// =============================================================================
// Installation-Repository Link Management
// =============================================================================

/**
 * Mark a repository as inactive for an installation.
 *
 * Uses UPDATE semantics: if the row doesn't exist (e.g., repo was never synced),
 * this is a no-op. This avoids FK violations when webhooks arrive before the
 * repository record is created in the sync process. The subsequent sync will
 * handle the state correctly.
 */
export async function markInstallationRepositoryInactive(
  context: GithubServiceContext,
  installationId: number,
  repositoryId: number,
): Promise<void> {
  await context.db
    .update(githubInstallationRepository)
    .set({
      isActive: false,
      removedAt: new Date(),
    })
    .where(
      and(
        eq(githubInstallationRepository.installationId, installationId),
        eq(githubInstallationRepository.repositoryId, repositoryId),
      ),
    );
}
