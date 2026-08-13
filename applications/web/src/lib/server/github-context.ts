/**
 * GitHub service context adapter for SvelteKit.
 *
 * Wires SvelteKit singletons (database, Redis cache, GitHub App) into the
 * `GithubServiceContext` interface expected by `@tribunal/github` package
 * functions.
 *
 * Route handlers and other SvelteKit code import `githubContext` from
 * this module and pass it as the first argument to package functions.
 */

import { db } from '$lib/server/database';
import {
  getCached,
  setCache,
  setCacheIndefinitely,
  deleteCache,
  deleteCacheByPattern,
  resetCacheClient,
} from '$lib/server/redis';
import {
  getInstallationOctokit,
  getGithubApplication,
} from '$lib/server/github/github-application';
import { getWeftClient } from '$lib/server/weft/engine';
import type { GithubServiceContext } from '@tribunal/github/context';
import {
  cancelInstallationSyncEngine,
  cancelReviewWorkflowsEngine,
  createFailedWorkflowCancellationResult,
  parseWorkflowCancellationResult,
} from '$lib/server/review/engine-client';
import { isWeftFault } from '@lostgradient/weft';

export const githubContext: GithubServiceContext = {
  db,
  cache: {
    getCached,
    setCache,
    setCacheIndefinitely,
    deleteCache,
    deleteCacheByPattern,
    resetCacheClient,
  },
  getInstallationOctokit,
  getGithubApplication,
  // Resolve the local Weft client lazily for local/test producers that still use
  // this context directly. Production installation sync goes through the engine
  // control endpoint; `WEFT_DATABASE_URL` remains owned by tribunal-engine.
  resolveWeftClient: getWeftClient,
  async cancelInstallationSync(installationId) {
    const result = await cancelInstallationSyncEngine(installationId);
    if (result.status === 'not_configured') {
      console.warn(
        '[github-context] Installation sync engine control is not configured; skipping remote cancellation.',
        { installationId, missingSettings: result.missingSettings },
      );
      return;
    }
    if (result.status === 'failed') {
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }
    if (!result.ok) {
      throw new Error(
        `Installation sync engine cancellation failed with status ${result.responseStatus}.`,
      );
    }
  },
  async cancelWorkflowsById(workflowIds, cancellationReason, userId) {
    const result =
      cancellationReason === undefined && userId === undefined
        ? await cancelReviewWorkflowsEngine(workflowIds)
        : await cancelReviewWorkflowsEngine(workflowIds, cancellationReason, userId);
    if (result.status === 'not_configured') {
      if (userId !== undefined) {
        return createFailedWorkflowCancellationResult(
          workflowIds,
          new Error('User-scoped review workflow cancellation is not configured.'),
        );
      }
      console.warn(
        '[github-context] Review workflow engine control is not configured; falling back to local cancellation.',
        { workflowCount: workflowIds.length, missingSettings: result.missingSettings },
      );
      const client = await getWeftClient().catch(() => null);
      if (!client) {
        return createFailedWorkflowCancellationResult(
          workflowIds,
          new Error('Review workflow engine control and local cancellation are unavailable.'),
        );
      }
      let cancelled = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const workflowId of workflowIds) {
        try {
          await client.cancel(workflowId);
          cancelled++;
        } catch (error) {
          if (isWeftFault(error, 'WorkflowNotFoundError')) {
            continue;
          }
          failed++;
          errors.push(`${workflowId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { cancelled, failed, errors };
    }
    if (result.status === 'failed') {
      return createFailedWorkflowCancellationResult(workflowIds, result.error);
    }
    if (!result.ok) {
      const cancellation = parseWorkflowCancellationResult(result.body);
      if (cancellation !== null) return cancellation;
      return createFailedWorkflowCancellationResult(
        workflowIds,
        new Error(
          `Review workflow engine cancellation failed with status ${result.responseStatus}.`,
        ),
      );
    }
    return { cancelled: workflowIds.length, failed: 0, errors: [] };
  },
};
