import { createToolErrorResponse } from '@lostgradient/mcp';
import type { RepositoryReadError } from './readers/repository-reader';
import type { PullRequestReadError } from './readers/pull-request-reader';

/**
 * The engine's subject identifier did not parse as a Tribunal user identifier.
 *
 * This is an internal inconsistency rather than anything the caller did, so
 * the message says what happened without echoing the value back — an error
 * that reflects an attacker-supplied subject is a small oracle, and there is
 * nothing a client could do with it anyway.
 */
export function unresolvedSubjectError() {
  return createToolErrorResponse(
    'This access token is not bound to a Tribunal account. Reconnect the integration and try again.',
  );
}

/**
 * Everything a tool can fail with, across all five capability families.
 *
 * The row-level cases are their own values rather than a shared `not_found`
 * because the message differs; what they share is that "belongs to somebody
 * else" and "does not exist" always produce the same answer.
 */
export type McpReadError =
  | RepositoryReadError
  | PullRequestReadError
  | 'review_run_not_found'
  | 'review_finding_not_found'
  /** Neither a repository id nor an owner-and-name pair was supplied. */
  | 'repository_selector_missing'
  /** Both forms were supplied, and acting on either would be a guess. */
  | 'repository_selector_conflict';

/**
 * Caller-facing text for a failed read.
 *
 * `repository_not_found` deliberately covers three states — no such
 * repository, not connected to Tribunal, connected by somebody else — because
 * distinguishing them would let a caller enumerate repositories it cannot
 * reach. The two row-level cases below collapse the same way.
 */
export function describeReadError(error: McpReadError): string {
  switch (error) {
    case 'no_github_token':
      return 'Tribunal has no valid GitHub token for your account. Reconnect GitHub and try again.';
    case 'github_unavailable':
      return 'GitHub could not be reached to confirm which repositories you can access. Try again shortly.';
    case 'repository_not_found':
      // Selector-neutral on purpose: naming an id the caller never sent
      // invites a model to invent one, and the owner-and-name form is the only
      // route a client holding `pull_requests:read` alone can use.
      return 'No repository matching that id, or that owner and name, is connected to your Tribunal account.';
    case 'github_unreachable':
      return "That repository's GitHub App installation could not be resolved. Check the installation and try again.";
    case 'pull_request_not_found':
      return 'No pull request with that number exists in this repository.';
    case 'github_rate_limited':
      return 'GitHub rate-limited this read. Wait a little and try again.';
    case 'github_read_failed':
      return 'GitHub refused or failed this read. Check the app installation still has access, then try again.';
    case 'review_run_not_found':
      return 'No review run with that id belongs to your Tribunal account.';
    case 'review_finding_not_found':
      return 'No finding with that id belongs to your Tribunal account.';
    case 'repository_selector_missing':
      return 'Name the repository, either as repositoryId or as owner and name together.';
    case 'repository_selector_conflict':
      return 'Send either repositoryId or owner and name, not both — they can disagree, and guessing which one you meant is not safe.';
  }
}

/** A failed read, rendered as a tool error the model can read and report. */
export function readErrorResponse(error: McpReadError) {
  return createToolErrorResponse(describeReadError(error));
}
