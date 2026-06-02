/**
 * Repository event handlers for GitHub webhooks.
 *
 * Handles: repository.renamed, repository.transferred, repository.edited
 */

import type { GithubServiceContext } from '../../context.js';
import {
  updateRepositoryMetadata,
  updateRepositoryDefaultBranch,
} from '../../repositories/service.js';
import {
  isRepositoryRenamedEvent,
  isRepositoryTransferredEvent,
  isRepositoryEditedEvent,
} from '../validate-github-webhook.js';
import type { WebhookPayload } from '../types.js';

/**
 * Handle repository metadata events (rename, transfer, edit).
 * These events require updating our stored repository metadata.
 * Does not return a HandlerResult since these events don't short-circuit processing.
 */
export async function handleRepositoryMetadataEvents(
  context: GithubServiceContext,
  data: WebhookPayload,
): Promise<void> {
  if (isRepositoryRenamedEvent(data)) {
    try {
      await updateRepositoryMetadata(
        context,
        data.repository.id,
        data.repository.owner.login,
        data.repository.name,
        data.installation?.id ?? null,
      );
      console.log(`Repository renamed: ${data.repository.full_name} (ID: ${data.repository.id})`);
    } catch (e) {
      console.error('Failed to update repository after rename:', e);
    }
  }

  if (isRepositoryTransferredEvent(data)) {
    try {
      await updateRepositoryMetadata(
        context,
        data.repository.id,
        data.repository.owner.login,
        data.repository.name,
        data.installation?.id ?? null,
      );
      console.log(
        `Repository transferred: ${data.repository.full_name} (ID: ${data.repository.id})`,
      );
    } catch (e) {
      console.error('Failed to update repository after transfer:', e);
    }
  }

  if (isRepositoryEditedEvent(data)) {
    // Only update if default branch actually changed to a different value
    if (
      data.changes?.default_branch &&
      data.changes.default_branch.from !== data.repository.default_branch
    ) {
      try {
        await updateRepositoryDefaultBranch(
          context,
          data.repository.id,
          data.repository.default_branch,
        );
        console.log(
          `Repository default branch updated: ${data.repository.full_name} (ID: ${data.repository.id}) → ${data.repository.default_branch}`,
        );
      } catch (e) {
        console.error('Failed to update repository default branch:', e);
      }
    }
  }
}
