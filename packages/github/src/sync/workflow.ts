import {
  activity,
  signal,
  workflow,
  type ActivityContext,
  type WorkflowContext,
} from '@lostgradient/weft';
import { and, eq, isNull, lte, or } from '@tribunal/database/operators';
import { githubInstallation } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';
import { refreshInstallationRepositories } from '../repositories/service.js';
import type { EnqueueInstallationSyncOptions } from './types.js';

type SyncRequestedPayload = EnqueueInstallationSyncOptions;
type SyncFinalizerState = { installationId: number; workflowStartedAt?: number };
type GithubContextResolver = GithubServiceContext | (() => GithubServiceContext);

const syncRequestedSignal = signal<SyncRequestedPayload>('sync_requested');
const DEBOUNCE_DURATION = '15s';

export function createInstallationSyncWorkflow(contextResolver: GithubContextResolver) {
  const syncRepositories = createSyncRepositoriesActivity(contextResolver);
  const reconcileSyncStatusOnTeardown = createSyncStatusTeardownActivity(contextResolver);

  const installationSyncWorkflow = workflow({
    name: 'installation-sync',
    finalizer: activity({
      name: 'reconcileSyncStatusOnTeardown',
      execute: reconcileSyncStatusOnTeardown,
      timeout: '1m',
    }),
  })
    .activities({
      syncRepositories: {
        execute: syncRepositories,
        timeout: '5m',
      },
    })
    .signals({
      sync_requested: syncRequestedSignal,
    })
    .execute(async function* (workflowContext, input: EnqueueInstallationSyncOptions) {
      const { installationId } = input;

      workflowContext.setFinalizerState({
        installationId,
        workflowStartedAt: workflowContext.startedAt,
      } satisfies SyncFinalizerState);

      workflowContext.log?.info('installation-sync: debouncing', {
        installationId,
        reason: input.reason,
        workspaceId: input.workspaceId,
        triggeredByUserId: input.triggeredByUserId,
      });

      yield* workflowContext.sleep(DEBOUNCE_DURATION);

      while (true) {
        yield* drainBufferedSignals(workflowContext);

        workflowContext.log?.info('installation-sync: starting sync', { installationId });

        try {
          const result = yield* workflowContext.run('syncRepositories', { installationId });

          workflowContext.log?.info('installation-sync: sync complete', {
            installationId,
            repositoryCount: result.repositoryCount,
            deactivatedRepositoryCount: result.deactivatedRepositoryCount,
          });
        } catch (error) {
          workflowContext.log?.error('installation-sync: sync failed, exiting loop', {
            installationId,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        const sawSignalDuringSync = yield* drainBufferedSignals(workflowContext);

        if (!sawSignalDuringSync) {
          workflowContext.log?.info('installation-sync: no pending signals, workflow complete', {
            installationId,
          });
          return;
        }

        workflowContext.log?.info('installation-sync: new signal received during sync, looping', {
          installationId,
        });
        yield* workflowContext.sleep(DEBOUNCE_DURATION);
      }
    });

  return { installationSyncWorkflow, syncRepositories, reconcileSyncStatusOnTeardown };
}

function createSyncRepositoriesActivity(contextResolver: GithubContextResolver) {
  return async function syncRepositories(
    input: { installationId: number },
    activityContext?: ActivityContext,
  ): Promise<{
    repositoryCount: number;
    deactivatedRepositoryCount: number;
  }> {
    const { installationId } = input;
    const syncWorkflowExecutionToken = activityContext?.workflowExecutionToken;
    const syncActivityAttemptToken = activityContext?.activityAttemptToken;
    if ((syncWorkflowExecutionToken === undefined) !== (syncActivityAttemptToken === undefined)) {
      throw new Error('Installation sync requires workflow and activity attempt tokens together.');
    }

    activityContext?.signal.throwIfAborted();
    const context = resolveGithubContext(contextResolver);

    const claimStartedAt = new Date();
    await context.db
      .update(githubInstallation)
      .set({
        syncStatus: 'in_progress',
        syncStartedAt: claimStartedAt,
        syncWorkflowExecutionToken: syncWorkflowExecutionToken ?? null,
        syncActivityAttemptToken: syncActivityAttemptToken ?? null,
      })
      .where(
        buildActivityClaimPredicate(
          installationId,
          syncWorkflowExecutionToken,
          syncActivityAttemptToken,
        ),
      );

    try {
      const refreshOptions =
        syncWorkflowExecutionToken === undefined || syncActivityAttemptToken === undefined
          ? {}
          : { syncWorkflowExecutionToken, syncActivityAttemptToken };
      return await refreshInstallationRepositories(context, installationId, refreshOptions);
    } catch (error) {
      await context.db
        .update(githubInstallation)
        .set({
          syncStatus: 'failed',
          syncStartedAt: null,
          syncWorkflowExecutionToken: null,
          syncActivityAttemptToken: null,
        })
        .where(
          buildActivitySyncPredicate(
            installationId,
            syncWorkflowExecutionToken,
            syncActivityAttemptToken,
          ),
        );

      throw error;
    }
  };
}

function createSyncStatusTeardownActivity(contextResolver: GithubContextResolver) {
  return async function reconcileSyncStatusOnTeardown(
    state: SyncFinalizerState,
    activityContext?: ActivityContext,
  ): Promise<void> {
    const { installationId, workflowStartedAt } = state;
    const syncWorkflowExecutionToken = activityContext?.workflowExecutionToken;
    const context = resolveGithubContext(contextResolver);

    await context.db
      .update(githubInstallation)
      .set({
        syncStatus: 'failed',
        syncStartedAt: null,
      })
      .where(
        buildFinalizerSyncPredicate(installationId, syncWorkflowExecutionToken, workflowStartedAt),
      );
  };
}

function resolveGithubContext(contextResolver: GithubContextResolver): GithubServiceContext {
  return typeof contextResolver === 'function' ? contextResolver() : contextResolver;
}

function* drainBufferedSignals(
  workflowContext: WorkflowContext,
): Generator<unknown, boolean, unknown> {
  let sawSignal = false;
  while (true) {
    const drainResult = yield* workflowContext.race([
      workflowContext.waitForSignal('sync_requested'),
      workflowContext.sleep(0),
    ] as const);
    if (drainResult === undefined) return sawSignal;
    sawSignal = true;
  }
}

function buildActivitySyncPredicate(
  installationId: number,
  syncWorkflowExecutionToken?: string,
  syncActivityAttemptToken?: string,
) {
  const installationPredicate = eq(githubInstallation.installationId, installationId);
  const inProgressPredicate = eq(githubInstallation.syncStatus, 'in_progress');
  if (syncWorkflowExecutionToken === undefined) {
    return and(installationPredicate, inProgressPredicate);
  }

  const predicates = [
    installationPredicate,
    inProgressPredicate,
    eq(githubInstallation.syncWorkflowExecutionToken, syncWorkflowExecutionToken),
  ];
  if (syncActivityAttemptToken !== undefined) {
    predicates.push(eq(githubInstallation.syncActivityAttemptToken, syncActivityAttemptToken));
  }

  return and(...predicates);
}

function buildActivityClaimPredicate(
  installationId: number,
  syncWorkflowExecutionToken: string | undefined,
  syncActivityAttemptToken: string | undefined,
) {
  const installationPredicate = eq(githubInstallation.installationId, installationId);
  if (syncWorkflowExecutionToken === undefined || syncActivityAttemptToken === undefined) {
    return installationPredicate;
  }

  return and(
    installationPredicate,
    or(
      isNull(githubInstallation.syncWorkflowExecutionToken),
      eq(githubInstallation.syncWorkflowExecutionToken, syncWorkflowExecutionToken),
    ),
  );
}

function buildFinalizerSyncPredicate(
  installationId: number,
  syncWorkflowExecutionToken?: string,
  workflowStartedAt?: number,
) {
  const installationPredicate = eq(githubInstallation.installationId, installationId);
  const inProgressPredicate = eq(githubInstallation.syncStatus, 'in_progress');
  if (syncWorkflowExecutionToken === undefined) {
    return and(installationPredicate, inProgressPredicate);
  }

  const tokenPredicates = [
    eq(githubInstallation.syncWorkflowExecutionToken, syncWorkflowExecutionToken),
    isNull(githubInstallation.syncWorkflowExecutionToken),
  ];
  if (workflowStartedAt !== undefined) {
    tokenPredicates.push(lte(githubInstallation.syncStartedAt, new Date(workflowStartedAt)));
  }

  return and(installationPredicate, inProgressPredicate, or(...tokenPredicates));
}
