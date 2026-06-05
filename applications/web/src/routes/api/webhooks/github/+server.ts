import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ValidationError } from '@tribunal/github/error-taxonomy';
import { storeWebhookEvent } from '@tribunal/github/webhooks/webhook-events';
import { githubContext } from '$lib/server/github-context';
import type { RequestHandler } from './$types';

// Import modular webhook utilities
import {
  type WebhookPayload,
  validateRequest,
  verifySignature,
  extractEventFields,
  getRepositoryIdentity,
  invalidateGitHubAccessCacheForEvent,
  invalidateGitHubResourceCacheForEvent,
  dispatchPRStateTracking,
  handleRepositoryMetadataEvents,
  isPullRequestWebhookEvent,
} from '$lib/server/github/webhooks';
import { claimWebhookDelivery } from '@tribunal/github/webhooks/claim-delivery';

// Import typed webhook handlers
import { handlePullRequestEvent } from './handlers/pull-request.server';
import { handlePullRequestReview } from './handlers/pull-request-review.server';
import { handlePullRequestReviewComment } from './handlers/pull-request-review-comment.server';
import { handleCheckRun } from './handlers/check-run.server';
import { handleCheckSuite } from './handlers/check-suite.server';
import { handleInstallation } from './handlers/installation-lifecycle.server';
import { handleInstallationRepositories } from './handlers/installation-repositories-lifecycle.server';
import { handleInstallationTarget } from './handlers/installation-target-lifecycle.server';
import { handleAuthorization } from './handlers/authorization-lifecycle.server';
import { handlePush } from './handlers/push-lifecycle.server';
import { handleIssueComment } from './handlers/issue-comment.server';
import { handleReviewThread } from './handlers/review-thread.server';
import type { WebhookContext } from './handlers/types';
import { createGithubWebhookRouter } from 'github-webhook-schemas/registry';

// ============================================================================
// WEBHOOK EVENT ROUTING
// ============================================================================

/**
 * Create a webhook dispatcher that uses createGithubWebhookRouter for typed
 * event routing. A new router is created per-request so handler closures can
 * capture the request-scoped WebhookContext.
 *
 * The router validates payloads against Zod schemas from github-webhook-schemas
 * and dispatches to the matching handler. We capture the handler's promise in a
 * closure variable and await it after the synchronous router call completes,
 * because the router itself does not await async handlers.
 */
/**
 * Event types that are handled by the typed router (not the manual fallback path).
 * Used to detect Zod validation failures that would otherwise silently skip orchestrator signals.
 */
const ROUTER_HANDLED_EVENT_TYPES = new Set([
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'check_run',
  'check_suite',
  'installation',
  'installation_repositories',
  'installation_target',
  'github_app_authorization',
  'push',
]);

function createWebhookDispatcher(context: WebhookContext) {
  let handlerPromise: Promise<void> | undefined;

  const router = createGithubWebhookRouter({
    pullRequest: (event) => {
      handlerPromise = handlePullRequestEvent(event, context);
    },
    pullRequestReview: (event) => {
      handlerPromise = handlePullRequestReview(event, context);
    },
    pullRequestReviewComment: (event) => {
      handlerPromise = handlePullRequestReviewComment(event, context);
    },
    checkRun: (event) => {
      handlerPromise = handleCheckRun(event, context);
    },
    checkSuite: (event) => {
      handlerPromise = handleCheckSuite(event, context);
    },
    installation: (event) => {
      handlerPromise = handleInstallation(event, context);
    },
    installationRepositories: (event) => {
      handlerPromise = handleInstallationRepositories(event, context);
    },
    installationTarget: (event) => {
      handlerPromise = handleInstallationTarget(event, context);
    },
    githubAppAuthorization: (event) => {
      handlerPromise = handleAuthorization(event, context);
    },
    push: (event) => {
      handlerPromise = handlePush(event, context);
    },
  });

  return async (payload: unknown): Promise<boolean> => {
    router(payload);
    if (handlerPromise) {
      await handlerPromise;
      return true;
    }
    return false;
  };
}

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  const webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('GITHUB_APP_WEBHOOK_SECRET is not configured');
    error(500, 'Webhook secret not configured');
  }

  // 1. Validate request and extract payload
  const { payload, signature, eventType, deliveryId } = await validateRequest(request);
  const hookId = request.headers.get('x-github-hook-id') ?? undefined;

  // 2. Verify signature FIRST (security gate)
  await verifySignature(payload, signature, webhookSecret, { deliveryId, eventType });

  const data: WebhookPayload = JSON.parse(payload);
  const action = typeof data.action === 'string' ? data.action : null;

  console.log(`GitHub webhook received: ${eventType} - ${action ?? 'N/A'}`);

  // 3. Claim-Before-Processing Pattern for non-orchestrator events
  // Orchestrator triggers defer claiming until after successful processing,
  // so GitHub can retry on transient failures (500). All other events claim early.
  const installation = data.installation as { id: number } | undefined;
  const repository = data.repository as { id: number } | undefined;
  const installationId = installation?.id;
  const repositoryId = repository?.id;

  const isOrchestratorTrigger = isPullRequestWebhookEvent(eventType, action, data);

  if (deliveryId && eventType && !isOrchestratorTrigger) {
    const claimed = await claimWebhookDelivery(
      githubContext,
      deliveryId,
      eventType,
      installationId,
    );

    if (!claimed) {
      console.log(`Skipping duplicate webhook: ${eventType} / ${deliveryId}`);
      return json({ ok: true, message: 'Already processed' });
    }
  }

  // 4. Store event if it has a repository
  if (repository && deliveryId && eventType) {
    try {
      const { owner, repo } = getRepositoryIdentity(data);
      const eventFields = extractEventFields(eventType, data);
      const sender = data.sender as { id: number; login: string } | undefined;

      await storeWebhookEvent(githubContext, {
        eventType,
        action,
        deliveryId,
        payload,
        repositoryId: repository.id,
        repositoryOwner: owner ?? '',
        repositoryName: repo ?? '',
        installationId: installationId ?? null,
        senderId: sender?.id ?? null,
        senderLogin: sender?.login ?? null,
        ...eventFields,
      });
    } catch (e) {
      console.error('Failed to store webhook event:', e);
    }
  }

  // 5. Build context for handlers
  // Note: Some event types (e.g., github_app_authorization) don't have installation or repository
  if (!deliveryId || !eventType) {
    console.log('Event missing required metadata (deliveryId or eventType)');
    return json({ ok: true });
  }

  const logger: WebhookContext['logger'] = {
    debug: (msg: string | object, ...args: unknown[]) => console.log(msg, ...args),
    info: (msg: string | object, ...args: unknown[]) => console.log(msg, ...args),
    warn: (msg: string | object, ...args: unknown[]) => console.warn(msg, ...args),
    error: (obj: object | string, message?: string) => console.error(obj, message),
    child: (_bindings: object) => logger,
  };

  const context: WebhookContext = {
    deliveryId,
    installationId: installationId ?? 0, // Authorization events don't have installationId
    repositoryId: repositoryId ?? 0, // Authorization events don't have repositoryId
    hookId,
    logger,
  };

  // 6. Route to typed handlers and dispatch orchestrator signals
  try {
    // Route events with Zod schemas through the typed router
    const dispatch = createWebhookDispatcher(context);
    const handlerDispatched = await dispatch(data);

    // Guard against silent Zod validation failures for orchestrator events.
    // If the event type is handled by the typed router but no handler ran, the payload failed
    // schema validation. For orchestrator triggers this would result in a silent claim with no
    // signal sent — GitHub would not retry because the delivery appears processed. Throw so the
    // caller can return 500 and allow GitHub to retry with the original payload.
    if (
      isOrchestratorTrigger &&
      !handlerDispatched &&
      eventType &&
      ROUTER_HANDLED_EVENT_TYPES.has(eventType)
    ) {
      throw new Error(
        `[webhook] Orchestrator trigger '${eventType}' failed schema validation — delivery not claimed`,
      );
    }

    // Fallback: dispatch orchestrator signals for event types without router schemas
    // (issue_comment on PRs, pull_request_review_thread)
    if (eventType === 'issue_comment') {
      await handleIssueComment(action, data, context);
    } else if (eventType === 'pull_request_review_thread') {
      await handleReviewThread(action, data, context);
    }
  } catch (e) {
    if (isOrchestratorTrigger) {
      console.error('[webhook] Orchestrator signal dispatch failed:', e);
      // Return 500 so GitHub retries this delivery (orchestrator failures)
      error(500, 'Orchestrator signal dispatch failed');
    } else {
      // For non-orchestrator events, the delivery may already be claimed. Log and continue
      // so we do not create a claimed-but-unprocessed drop that GitHub will not retry.
      console.error('[webhook] Non-orchestrator webhook handler failed:', {
        eventType,
        action,
        deliveryId,
        error: e,
      });
    }
  }

  // Claim orchestrator events after successful processing.
  // Runs for ALL orchestrator triggers including no-op paths (no workspace, bot events,
  // unassociated checks) to prevent unnecessary GitHub retries. Matches pre-refactor behavior.
  // For orchestrator triggers: error() in the catch always throws and exits, so this is only
  // reached on success. For non-orchestrator triggers: isOrchestratorTrigger is false, so
  // this block is skipped regardless of whether the handler threw.
  if (isOrchestratorTrigger) {
    await claimWebhookDelivery(githubContext, deliveryId, eventType, installationId);
  }

  // 7. Pull request review dispatch would have happened here. The workflow
  // runtime has been removed, so we log what would have been dispatched.
  // TODO(weft): Dispatch this pull request review workflow through ../weft once
  // durable webhook orchestration is restored.
  console.log('[webhook] would dispatch pull-request-review workflow', {
    eventType,
    action: action ?? undefined,
    deliveryId,
  });

  // 8. Handle repository rename/transfer events
  await handleRepositoryMetadataEvents(githubContext, data);

  // 9. Invalidate GitHub access and resource caches for events that affect repository data
  await invalidateGitHubAccessCacheForEvent(githubContext, data);
  await invalidateGitHubResourceCacheForEvent(githubContext, eventType, action, data);

  // 10. PR state tracking (fire-and-forget)
  dispatchPRStateTracking(githubContext, eventType, action, data);

  return json({ ok: true });
};

export const GET: RequestHandler = async (event) => {
  if (!event.locals.user) {
    error(401, 'Authentication required');
  }

  try {
    const { getRegisteredWebhooks } = await import('@tribunal/github/webhooks/registered-webhooks');
    const result = await getRegisteredWebhooks(githubContext);
    return json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return json({ error: 'GitHub App is not configured' }, { status: 400 });
    }

    console.error('Failed to fetch registered GitHub webhooks:', err);
    return json({ error: 'Failed to fetch registered GitHub webhooks' }, { status: 502 });
  }
};
