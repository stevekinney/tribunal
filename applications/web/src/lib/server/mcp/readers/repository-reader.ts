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
  /**
   * The installation the caller's access was actually resolved through.
   *
   * Carried rather than re-derived because a repository can hold link rows for
   * more than one installation — a transfer that left the old link behind is
   * the ordinary way it happens — and re-resolving picks one globally rather
   * than the one that authorized this caller. See
   * `pull-request-reader.ts`'s `resolveAuthorizedInstallation`.
   */
  installationId: number;
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
  // `recordTokenInvalidation: false` is what keeps `readOnlyHint: true` true.
  // The default path writes `oauth_connection.status = 'invalid'` when GitHub
  // answers 401, so without this every repository and pull request tool could
  // mutate persistent integration state while answering a read. The revocation
  // is GitHub's fact rather than this request's, and the next interactive page
  // load records it.
  //
  // One write is deliberately left in place, and naming it here is the point:
  // `getUserOctokit` rotates a token that is about to expire and persists the
  // new one. That is credential maintenance the transport performs to make the
  // read possible at all, not a change to any repository, pull request,
  // review, finding, or cost record — the resources these scopes actually
  // govern. Suppressing it would make a call arriving inside the refresh
  // window fail rather than succeed, which trades a real behaviour for a
  // definitional one. `readOnlyHint` describes what the tool does to the
  // user's data; this rotation is invisible to them and changes none of it.
  const result = await getRepositoriesForUser(userId, { recordTokenInvalidation: false });
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
      installationId: entry.installation.installationId,
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

/**
 * Resolves a repository by the owner and name a person would actually type.
 *
 * This exists so `pull_requests:read` is usable on its own. Scopes are granted
 * independently, and a client holding only that scope has no way to learn a
 * numeric repository id — `list_repositories` is gated on `repositories:read`,
 * which the user may have declined. Without a name-based path the whole
 * capability family is unreachable under a grant the consent screen offers,
 * which is a worse outcome than the extra resolution step.
 *
 * Matching is case-insensitive because GitHub treats owner and repository names
 * that way, and the caller is typing what a person told them.
 */
export async function findAccessibleRepositoryByName(
  userId: number,
  owner: string,
  name: string,
): Promise<RepositoryLookupResult> {
  const result = await listAccessibleRepositories(userId);
  if (!result.ok) return result;

  const wantedOwner = owner.toLowerCase();
  const wantedName = name.toLowerCase();

  return {
    ok: true,
    repository:
      result.repositories.find(
        (entry) =>
          entry.owner.toLowerCase() === wantedOwner && entry.name.toLowerCase() === wantedName,
      ) ?? null,
  };
}
