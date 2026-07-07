/**
 * GitHub webhook handling utilities.
 */

// Types and constants — moved to package
export {
  type WebhookPayload,
  type HandlerResult,
  MAX_PAYLOAD_SIZE,
} from '@tribunal/github/webhooks/types';

// Request validation — stays local (uses @sveltejs/kit error)
export { validateRequest, verifySignature, type ValidatedRequest } from './request';

// Field extraction — moved to package
export { extractEventFields, getRepositoryIdentity } from '@tribunal/github/webhooks/extract';

// Access cache invalidation — moved to package
export { invalidateGitHubAccessCacheForEvent } from '@tribunal/github/webhooks/access-invalidation';

// Resource cache invalidation — moved to package
export { invalidateGitHubResourceCacheForEvent } from '@tribunal/github/webhooks/resource-invalidation';

// Pull request orchestrator event filtering — moved to package
export { isPullRequestWebhookEvent } from '@tribunal/github/webhooks/pull-request-event-filter';

// Re-run trigger detection (check_run.rerequested / requested_action, check_suite.rerequested)
export {
  isRerunTriggerWebhookEvent,
  RE_REVIEW_ACTION_IDENTIFIER,
} from '@tribunal/github/webhooks/re-run-triggers';

// PR state dispatch — moved to package
export {
  dispatchPRStateTracking,
  dispatchBaseBranchUpdate,
} from '@tribunal/github/webhooks/pr-state-dispatch';

// Event handlers — stays local (SvelteKit handler files)
export { getPrimaryWorkspaceIdForInstallation, handleRepositoryMetadataEvents } from './handlers';
