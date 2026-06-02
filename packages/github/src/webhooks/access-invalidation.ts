/**
 * GitHub access cache invalidation for webhook events.
 *
 * These events can change which users can access which repositories:
 * - member: Collaborator added/removed/changed permissions
 * - repository: Visibility changed, transferred, archived, made public
 * - team: Team added to repo, member added/removed, permissions changed
 * - installation_repositories: Repos added/removed from app installation
 * - organization/membership: Org member role changes
 */

import type { GithubServiceContext } from '../context.js';
import { getRepositoryIdsByOwner } from '../repositories/service.js';
import {
  // Member event type guards
  isMemberAddedEvent,
  isMemberRemovedEvent,
  isMemberEditedEvent,
  // Repository event type guards
  isRepositoryPrivatizedEvent,
  isRepositoryPublicizedEvent,
  isRepositoryTransferredEvent,
  isRepositoryArchivedEvent,
  isRepositoryUnarchivedEvent,
  isRepositoryDeletedEvent,
  // Team event type guards
  isTeamAddedToRepositoryEvent,
  isTeamRemovedFromRepositoryEvent,
  // Installation repositories type guards
  isInstallationRepositoriesAddedEvent,
  isInstallationRepositoriesRemovedEvent,
  // Organization event type guards
  isOrganizationMemberAddedEvent,
  isOrganizationMemberRemovedEvent,
  // Membership event type guards
  isMembershipAddedEvent,
  isMembershipRemovedEvent,
  // Public event type guard
  isPublicEvent,
} from './validate-github-webhook.js';
import type { WebhookPayload } from './types.js';

/** Maximum repos to invalidate for org-level events to prevent runaway invalidations. */
const MAX_REPOS_TO_INVALIDATE = 1000;

/**
 * Invalidate GitHub access cache for events that affect repository access.
 * Never throws - logs errors and continues.
 */
export async function invalidateGitHubAccessCacheForEvent(
  context: GithubServiceContext,
  data: WebhookPayload,
): Promise<void> {
  const repositoryIdsToInvalidate: number[] = [];

  // Member events: collaborator added/removed/changed on a specific repo
  if (isMemberAddedEvent(data) || isMemberRemovedEvent(data) || isMemberEditedEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: member ${data.action} on ${data.repository.full_name}`);
  }

  // Repository events: visibility changed, transferred, archived, publicized, deleted
  if (isRepositoryPrivatizedEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository privatized - ${data.repository.full_name}`);
  }
  if (isRepositoryPublicizedEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository publicized - ${data.repository.full_name}`);
  }
  if (isRepositoryTransferredEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository transferred - ${data.repository.full_name}`);
  }
  if (isRepositoryArchivedEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository archived - ${data.repository.full_name}`);
  }
  if (isRepositoryUnarchivedEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository unarchived - ${data.repository.full_name}`);
  }
  if (isRepositoryDeletedEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository deleted - ${data.repository.full_name}`);
  }

  // Team events: team added/removed from repo, permissions changed
  if (isTeamAddedToRepositoryEvent(data) && data.repository) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: team added_to_repository on ${data.repository.full_name}`);
  }
  if (isTeamRemovedFromRepositoryEvent(data) && data.repository) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(
      `GitHub access cache: team removed_from_repository on ${data.repository.full_name}`,
    );
  }

  // Installation repositories events: repos added/removed from GitHub App installation
  if (isInstallationRepositoriesAddedEvent(data)) {
    for (const repo of data.repositories_added) {
      repositoryIdsToInvalidate.push(repo.id);
    }
    console.log(
      `GitHub access cache: installation_repositories added - ${data.repositories_added.length} repos`,
    );
  }
  if (isInstallationRepositoriesRemovedEvent(data)) {
    for (const repo of data.repositories_removed) {
      repositoryIdsToInvalidate.push(repo.id);
    }
    console.log(
      `GitHub access cache: installation_repositories removed - ${data.repositories_removed.length} repos`,
    );
  }

  // Organization events: org-level member changes affect all org repos
  if (isOrganizationMemberAddedEvent(data) || isOrganizationMemberRemovedEvent(data)) {
    const orgLogin = data.organization.login;
    try {
      const repoIds = await getRepositoryIdsByOwner(context, orgLogin);

      // Guardrail: warn for large invalidations
      if (repoIds.length > 100) {
        console.warn(
          `GitHub access cache: large org invalidation for ${orgLogin} - ${repoIds.length} repos (consider monitoring performance)`,
        );
      }

      // Cap at 1000 repos to prevent runaway invalidations
      const reposToProcess = repoIds.slice(0, MAX_REPOS_TO_INVALIDATE);
      if (repoIds.length > MAX_REPOS_TO_INVALIDATE) {
        console.warn(
          `GitHub access cache: capping invalidation at ${MAX_REPOS_TO_INVALIDATE} repos for ${orgLogin} (${repoIds.length} total)`,
        );
      }

      for (const repoId of reposToProcess) {
        repositoryIdsToInvalidate.push(repoId);
      }
      console.log(
        `GitHub access cache: organization ${data.action} - invalidating ${reposToProcess.length} repos for ${orgLogin}`,
      );
    } catch (e) {
      console.error(`Failed to get repos for org ${orgLogin}:`, e);
    }
  }

  // Membership events: team membership changes affect all org repos
  if (isMembershipAddedEvent(data) || isMembershipRemovedEvent(data)) {
    const orgLogin = data.organization.login;
    try {
      const repoIds = await getRepositoryIdsByOwner(context, orgLogin);

      // Guardrail: warn for large invalidations
      if (repoIds.length > 100) {
        console.warn(
          `GitHub access cache: large team invalidation for ${orgLogin} - ${repoIds.length} repos (consider monitoring performance)`,
        );
      }

      // Cap at 1000 repos to prevent runaway invalidations
      const reposToProcess = repoIds.slice(0, MAX_REPOS_TO_INVALIDATE);
      if (repoIds.length > MAX_REPOS_TO_INVALIDATE) {
        console.warn(
          `GitHub access cache: capping invalidation at ${MAX_REPOS_TO_INVALIDATE} repos for ${orgLogin} (${repoIds.length} total)`,
        );
      }

      for (const repoId of reposToProcess) {
        repositoryIdsToInvalidate.push(repoId);
      }
      console.log(
        `GitHub access cache: membership ${data.action} to team ${data.team.name} - invalidating ${reposToProcess.length} repos for ${orgLogin}`,
      );
    } catch (e) {
      console.error(`Failed to get repos for org ${orgLogin}:`, e);
    }
  }

  // Public event: deprecated but still fired when repo made public
  if (isPublicEvent(data)) {
    repositoryIdsToInvalidate.push(data.repository.id);
    console.log(`GitHub access cache: repository made public - ${data.repository.full_name}`);
  }

  // Invalidate access cache for all affected repositories
  for (const repoId of repositoryIdsToInvalidate) {
    try {
      await context.cache.deleteCacheByPattern(`github-access:*:${repoId}`);
    } catch (e) {
      console.error(`Failed to invalidate GitHub access cache for repository ${repoId}:`, e);
    }
  }
}
