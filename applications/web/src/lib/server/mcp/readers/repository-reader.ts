import { getRepositoriesForUser } from '$lib/server/repositories';

/**
 * A repository as an MCP client sees it: GitHub's own identity fields for the
 * repository, plus the installation account it resolves through.
 *
 * `owner`, `name`, and `defaultBranch` are chosen on GitHub by whoever
 * administers the repository, who need not be the authenticated user — so
 * every tool returning this projection carries the untrusted-content framing,
 * short and identifier-shaped though these strings are.
 */
export type McpRepository = {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string | null;
  latestCommit: string | null;
  installationAccount: string;
};

/** Why a repository read could not produce an answer, as the caller sees it. */
export type RepositoryReadError = 'no_github_token' | 'github_unavailable';

export type RepositoryListResult =
  { ok: true; repositories: McpRepository[] } | { ok: false; error: RepositoryReadError };

export type RepositoryLookupResult =
  { ok: true; repository: McpRepository | null } | { ok: false; error: RepositoryReadError };

/**
 * Every repository read goes through `getRepositoriesForUser`, and that is the
 * whole authorization story for this scope family.
 *
 * The obvious alternative — `getRepositoryById(repositoryId)` — is an unscoped
 * `SELECT` taking no user parameter, so a tool built on it would let any token
 * holder enumerate another user's repository metadata by guessing identifiers.
 * The names read as though the gate were built in; it is not. Resolving the
 * user's installation set first and filtering within it means an inaccessible
 * repository is indistinguishable from one that does not exist.
 */
export async function listAccessibleRepositories(userId: number): Promise<RepositoryListResult> {
  const result = await getRepositoriesForUser(userId);
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    repositories: result.repositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      latestCommit: entry.repository.commit,
      installationAccount: entry.installation.accountLogin,
    })),
  };
}

/**
 * Resolves one repository the user can actually reach, or `null`.
 *
 * Returning `null` rather than throwing keeps "not yours" and "does not exist"
 * the same answer at the tool boundary, which is what stops the tool being an
 * existence oracle for repositories connected by somebody else.
 */
export async function findAccessibleRepository(
  userId: number,
  repositoryId: number,
): Promise<RepositoryLookupResult> {
  const result = await listAccessibleRepositories(userId);
  if (!result.ok) return result;
  return {
    ok: true,
    repository: result.repositories.find((entry) => entry.id === repositoryId) ?? null,
  };
}
