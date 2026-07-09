import { createCostPort } from '@tribunal/cost';
import { createDatabase, type Database } from '@tribunal/database';
import { and, desc, eq, inArray, isNull, sql } from '@tribunal/database/operators';
import {
  agentRun,
  agentEvent,
  finding,
  githubInstallation,
  githubInstallationRepository,
  pullRequestReviewRun,
  pullRequestState,
  repository as repositoryTable,
  tribunalRun,
} from '@tribunal/database/schema';
import { createGithubApplicationSingleton } from '@tribunal/github';
import { createCache } from '@tribunal/github/cache';
import { createCheckRun, updateCheckRun } from '@tribunal/github/reviews/check-runs';
import { getDiffContext, getPullRequestMetadata } from '@tribunal/github/reviews/diff-context';
import { mintSingleRepositoryReadToken } from '@tribunal/github/reviews/read-tokens';
import {
  findPostedPullRequestReview,
  postPullRequestReview,
} from '@tribunal/github/reviews/pull-request-reviews';
import type { GithubServiceContext } from '@tribunal/github/context';
import {
  createSandboxPort,
  type SandboxAdapter,
  type SandboxCreateInput,
  verifySandboxReuseIsolation,
} from '@tribunal/sandbox';
import { Sandbox, SandboxClient } from 'tensorlake';
import type {
  UsageCostApiClient,
  UsageCostApiEvent,
  UsageCostReconciliationTarget,
} from '@tribunal/cost/usage-cost-api';
import type {
  CheckRunPatch,
  DiffContext,
  GitHubPort,
  RepoRef,
  ReviewPayload,
  SandboxPort,
} from '@tribunal/review-core';
import { isReviewPostAlreadyClaimedError, ReviewWorkflowEngine } from './review-workflow';
import { createDatabaseReviewIntentPort, getReviewIntentQueueStatus } from './review-intent-port';
import { createPullRequestWorkflowId, createReviewRunIdempotencyKey } from './identifiers';
import { createReviewWorkflowDefinitions } from './review-workflow-definitions';
import type {
  AgentRunRecord,
  ClaimedReviewIntent,
  FindingRecord,
  PullRequestReviewInput,
  ReviewPostClaimResult,
  ReviewRunRecord,
  ReviewWorkflowStatePort,
} from './review-workflow';

type EngineGitHubPort = GitHubPort & {
  findPostedReview(
    repository: RepoRef,
    pullRequestNumber: number,
    reviewMarker: string,
  ): Promise<{ comments: number } | undefined>;
};

export type ReviewIntentRuntimeEnvironment = {
  DATABASE_URL?: string;
  REDIS_URL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  TENSORLAKE_API_KEY?: string;
  TENSORLAKE_ORGANIZATION_ID?: string;
  TENSORLAKE_PROJECT_ID?: string;
  TRIBUNAL_SANDBOX_IMAGE?: string;
  TRIBUNAL_PROXY_URL?: string;
  TRIBUNAL_PROXY_CIDR?: string;
  PROXY_SIGNING_KEY?: string;
  ENCRYPTION_KEY?: string;
  TRIBUNAL_DEFAULT_MODEL?: string;
  DEFAULT_DAILY_COST_CAP_USD?: number | string;
  IDLE_SUSPEND_SECONDS?: number | string;
  ENABLE_PROMPT_CACHING_1H?: boolean | string;
  ANTHROPIC_ADMIN_KEY?: string;
  REVIEWS_ENABLED?: boolean | string;
};

export const emptyUsageCostApiClient = {
  listReviewRunCosts: async (_target: UsageCostReconciliationTarget) => [],
};

export const unconfiguredUsageCostApiClient = {
  listReviewRunCosts: async (_target: UsageCostReconciliationTarget) => {
    throw new Error('Authoritative usage cost reconciliation is not configured.');
  },
};

export function createReviewIntentConsumerFromEnvironment(
  environment: ReviewIntentRuntimeEnvironment,
) {
  if (!environment.DATABASE_URL) return undefined;

  const database = createDatabase(environment.DATABASE_URL);
  return createReviewIntentConsumer(database, environment);
}

export function createReviewIntentConsumer(
  database: Database,
  environment: ReviewIntentRuntimeEnvironment,
) {
  const githubContext = createEngineGithubContext(database, environment);
  const defaultDailyCostCapUsd = parsePositiveNumber(
    environment.DEFAULT_DAILY_COST_CAP_USD,
    25,
    'DEFAULT_DAILY_COST_CAP_USD',
  );
  const reviewIntentPortOptions = {
    reviewsEnabled: parseBooleanFlag(environment.REVIEWS_ENABLED, true),
  };
  const intentPort = createDatabaseReviewIntentPort(database, reviewIntentPortOptions);
  const reviewWorkflowEngine = new ReviewWorkflowEngine(
    {
      github: createEngineGitHubPort(database, githubContext),
      sandbox: createEngineSandboxPort(environment),
      cost: createCostPort(database, {
        usageCostApiClient: createAnthropicUsageCostApiClient(
          requireEnvironmentValue(environment.ANTHROPIC_ADMIN_KEY, 'ANTHROPIC_ADMIN_KEY'),
        ),
        defaultDailyCostCapUsd,
      }),
      intents: intentPort,
      state: createDatabaseReviewWorkflowStatePort(database),
    },
    {
      sandboxImage: requireEnvironmentValue(
        environment.TRIBUNAL_SANDBOX_IMAGE,
        'TRIBUNAL_SANDBOX_IMAGE',
      ),
      proxyUrl: requireEnvironmentValue(environment.TRIBUNAL_PROXY_URL, 'TRIBUNAL_PROXY_URL'),
      proxySigningKey: requireEnvironmentValue(environment.PROXY_SIGNING_KEY, 'PROXY_SIGNING_KEY'),
      runTokenTtlSeconds: 60 * 60,
      idleSuspendSeconds: parsePositiveInteger(
        environment.IDLE_SUSPEND_SECONDS,
        900,
        'IDLE_SUSPEND_SECONDS',
      ),
      defaultModel: requireEnvironmentValue(
        environment.TRIBUNAL_DEFAULT_MODEL,
        'TRIBUNAL_DEFAULT_MODEL',
      ) as Exclude<PullRequestReviewInput['agents'][number]['model'], 'inherit'>,
    },
  );
  let workflowEngine: ReviewIntentWorkflowEngine | undefined;

  return {
    workflows: createReviewWorkflowDefinitions(reviewWorkflowEngine),
    bindWorkflowEngine(engine: ReviewIntentWorkflowEngine) {
      workflowEngine = engine;
    },
    async drain(limit = 5) {
      if (workflowEngine === undefined) return reviewWorkflowEngine.claimReviewIntents(limit);

      let processed = 0;
      for (let attempt = 0; attempt < limit; attempt += 1) {
        const intent = await intentPort.claimNextReviewIntent(new Date());
        if (intent === null) return processed;

        try {
          const handle = await dispatchReviewIntentWorkflow(workflowEngine, intent);
          await handle.result();
          const markedProcessed = await intentPort.markReviewIntentProcessed(
            intent.id,
            intent.claimedAt,
            new Date(),
          );
          if (markedProcessed) processed += 1;
        } catch (error) {
          if (isReviewPostAlreadyClaimedError(error)) continue;
          await intentPort.markReviewIntentFailed(intent.id, intent.claimedAt, new Date(), error);
        }
      }

      return processed;
    },
    getQueueStatus(now: Date) {
      return getReviewIntentQueueStatus(database, now, reviewIntentPortOptions);
    },
    stopReviewRun(reviewRunId: string) {
      return reviewWorkflowEngine.stopRun(reviewRunId, 'timeout');
    },
    stopReviewAgent(reviewRunId: string, agentId: string) {
      return reviewWorkflowEngine.stopAgent(reviewRunId, agentId, 'timeout');
    },
    async reapClosedPullRequestSandboxes() {
      const openPullRequests = await listOpenPullRequestSandboxes(database);
      if (workflowEngine === undefined) {
        return reviewWorkflowEngine.reapClosedPullRequestSandboxes(openPullRequests);
      }
      const handle = await workflowEngine.start('sandbox-reaper', openPullRequests, {
        id: 'sandbox-reaper',
        onTerminalConflict: 'start-new',
        defer: false,
      });
      return handle.result();
    },
  };
}

type ReviewIntentWorkflowEngine = {
  start(
    workflowName: 'review-pr' | 'sandbox-reaper',
    input: ClaimedReviewIntent | Array<{ repositoryId: number; pullRequestNumber: number }>,
    options: {
      id: string;
      onTerminalConflict: 'start-new';
      defer: false;
    },
  ): Promise<ReviewIntentWorkflowHandle>;
};

async function listOpenPullRequestSandboxes(
  database: Database,
): Promise<Array<{ repositoryId: number; pullRequestNumber: number }>> {
  return database
    .select({
      repositoryId: pullRequestState.repositoryId,
      pullRequestNumber: pullRequestState.prNumber,
    })
    .from(pullRequestState)
    .where(eq(pullRequestState.state, 'open'));
}

export function createAnthropicUsageCostApiClient(adminKey: string): UsageCostApiClient {
  return {
    async listReviewRunCosts(target: UsageCostReconciliationTarget) {
      const events: UsageCostApiEvent[] = [];
      const startingAt = target.startedAt;
      const endingAt = target.finishedAt ?? new Date();
      let page: string | undefined;

      for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
        const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
        url.searchParams.set('starting_at', startingAt.toISOString());
        url.searchParams.set('ending_at', endingAt.toISOString());
        url.searchParams.append('group_by[]', 'workspace_id');
        url.searchParams.append('group_by[]', 'description');
        if (page !== undefined) url.searchParams.set('page', page);

        const response = await fetch(url, {
          headers: {
            'x-api-key': adminKey,
            'anthropic-version': '2023-06-01',
            'user-agent': 'Tribunal/0.0.1',
          },
        });
        if (!response.ok) {
          throw new Error(`Anthropic cost report request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as unknown;
        events.push(...parseAnthropicCostReport(payload, target, pageIndex));

        const payloadRecord = getRecord(payload);
        if (payloadRecord?.has_more !== true) return events;
        page = toNullableString(payloadRecord.next_page) ?? undefined;
        if (page === undefined) {
          throw new Error('Anthropic cost report response is missing next_page.');
        }
      }

      throw new Error('Anthropic cost report pagination exceeded 5 pages.');
    },
  };
}

function parseAnthropicCostReport(
  payload: unknown,
  target: UsageCostReconciliationTarget,
  pageIndex: number,
): UsageCostApiEvent[] {
  const rows = getCostReportRows(payload);
  const events: UsageCostApiEvent[] = [];
  let positiveUsdRowsWithReviewRunId = 0;
  let positiveUsdRowsWithoutReviewRunId = 0;

  for (const [index, row] of rows.entries()) {
    const metadata = getRecord(row.custom_metadata ?? row.metadata);
    if (row.currency !== undefined && row.currency !== 'USD') continue;
    const amountUsd = parseUsdDecimal(row.amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
    const rowReviewRunId = toNullableString(metadata?.review_run_id);
    if (rowReviewRunId === null) {
      positiveUsdRowsWithoutReviewRunId += 1;
      continue;
    }
    positiveUsdRowsWithReviewRunId += 1;
    if (rowReviewRunId !== target.reviewRunId) continue;
    const userId = toNullableInteger(metadata?.user_id ?? row.user_id) ?? target.userId;
    events.push({
      id: String(row.id ?? `${target.reviewRunId}:${pageIndex}:${index}`),
      occurredAt: new Date(String(row.starting_at ?? row.ending_at ?? Date.now())),
      amountUsd,
      userId,
      repositoryId:
        toNullableInteger(metadata?.repository_id ?? row.repository_id) ?? target.repositoryId,
      reviewRunId: target.reviewRunId,
      agentRunId: toNullableString(metadata?.agent_run_id ?? row.agent_run_id),
      agentId: toNullableString(metadata?.agent_id ?? row.agent_id),
      metadata: metadata ?? {},
    });
  }

  if (
    events.length === 0 &&
    positiveUsdRowsWithoutReviewRunId > 0 &&
    positiveUsdRowsWithReviewRunId === 0
  ) {
    throw new Error(
      'Anthropic cost report rows are missing review_run_id metadata; cannot safely reconcile organization-level costs.',
    );
  }

  return events;
}

function getCostReportRows(payload: unknown): Array<Record<string, unknown>> {
  const record = getRecord(payload);
  const buckets = Array.isArray(record?.data) ? record.data : [];
  return buckets.flatMap((bucket): Array<Record<string, unknown>> => {
    const bucketRecord = getRecord(bucket);
    if (bucketRecord === undefined || !Array.isArray(bucketRecord.results)) return [];
    return bucketRecord.results.flatMap((row): Array<Record<string, unknown>> => {
      const rowRecord = getRecord(row);
      return rowRecord === undefined
        ? []
        : [
            {
              ...rowRecord,
              starting_at: bucketRecord.starting_at,
              ending_at: bucketRecord.ending_at,
            },
          ];
    });
  });
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toNullableInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseUsdDecimal(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return Number.NaN;
  const amountUsd = Number(value);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return Number.NaN;
  return Number(amountUsd.toFixed(8));
}

type ReviewIntentWorkflowHandle = {
  result(): Promise<unknown>;
};

async function dispatchReviewIntentWorkflow(
  workflowEngine: ReviewIntentWorkflowEngine,
  intent: ClaimedReviewIntent,
): Promise<ReviewIntentWorkflowHandle> {
  return workflowEngine.start('review-pr', intent, {
    id: createPullRequestWorkflowId({
      repositoryId: intent.pullRequest.repositoryId,
      pullRequestNumber: intent.pullRequest.pullRequestNumber,
    }),
    onTerminalConflict: 'start-new',
    defer: false,
  });
}

export function createEngineGithubContext(
  database: Database,
  environment: ReviewIntentRuntimeEnvironment,
): GithubServiceContext {
  const cache = createCache(() => environment.REDIS_URL);
  const githubApplication = createGithubApplicationSingleton(() => ({
    appId: requireEnvironmentValue(environment.GITHUB_APP_ID, 'GITHUB_APP_ID'),
    privateKey: requireEnvironmentValue(
      environment.GITHUB_APP_PRIVATE_KEY,
      'GITHUB_APP_PRIVATE_KEY',
    ),
  }));

  return {
    db: database,
    cache,
    getInstallationOctokit: githubApplication.getInstallationOctokit,
    getGithubApplication: githubApplication.getGithubApplication,
    tokenEncryptionKey: environment.ENCRYPTION_KEY,
  };
}

export function createEngineGitHubPort(
  _database: Database,
  context: GithubServiceContext,
): EngineGitHubPort {
  return {
    async mintReadToken(repositoryId: number, installationId: number) {
      const token = await mintSingleRepositoryReadToken(context, { installationId, repositoryId });
      return { token: token.token, expiresAt: new Date(token.expiresAt) };
    },
    async getDiffContext(
      repository: RepoRef,
      pullRequestNumber: number,
      head: string,
      previousHead?: string,
    ): Promise<DiffContext> {
      const installationId = getExecutionInstallationId(repository);
      const pullRequest = await getPullRequestMetadata(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        pullRequestNumber,
      });
      const diffContext = await getDiffContext(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        pullRequestNumber,
        repositoryId: repository.repositoryId,
        headSha: head,
        currentHeadSha: pullRequest.headSha,
      });
      return {
        headSha: pullRequest.headSha || head,
        baseSha: pullRequest.baseSha,
        prevHeadSha: previousHead,
        changedFiles: diffContext.changedFiles.map((file) => ({
          path: file.path,
          status: normalizeFileStatus(file.status),
          patch: file.patch ?? undefined,
          commentableLines: file.commentableLines,
        })),
        pr: {
          number: pullRequestNumber,
          title: pullRequest.title,
          body: pullRequest.body,
          labels: pullRequest.labels,
          author: pullRequest.author,
        },
      };
    },
    async createCheckRun(repository: RepoRef, headSha: string) {
      const installationId = getExecutionInstallationId(repository);
      const checkRun = await createCheckRun(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        // Stable, unique name matching the intent-time creation (T-1) — a
        // check name only becomes selectable in branch protection after it
        // has run on the branch under this exact name.
        name: 'Tribunal Review',
        headSha,
        actions: [
          {
            label: 'Re-review',
            description: 'Run Tribunal review again',
            identifier: 're-review',
          },
        ],
      });
      return { checkRunId: checkRun.id };
    },
    async updateCheckRun(repository: RepoRef, checkRunId: number, patch: CheckRunPatch) {
      const installationId = getExecutionInstallationId(repository);
      await updateCheckRun(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        checkRunId,
        ...patch,
        completedAt: patch.status === 'completed' ? new Date().toISOString() : undefined,
      });
    },
    async postReview(repository: RepoRef, pullRequestNumber: number, review: ReviewPayload) {
      const installationId = getExecutionInstallationId(repository);
      const posted = await postPullRequestReview(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        pullRequestNumber,
        headSha: review.headSha,
        body: review.body,
        comments: review.comments,
      });
      return { comments: posted.id ? review.comments.length : 0 };
    },
    async findPostedReview(repository: RepoRef, pullRequestNumber: number, reviewMarker: string) {
      const installationId = getExecutionInstallationId(repository);
      const posted = await findPostedPullRequestReview(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        pullRequestNumber,
        reviewMarker,
      });
      return posted === undefined ? undefined : { comments: posted.comments };
    },
  };
}

function getExecutionInstallationId(repository: RepoRef): number {
  const installationId = (repository as RepoRef & { installationId?: unknown }).installationId;
  if (typeof installationId === 'number') return installationId;
  throw new Error('GitHub execution repository is missing installationId.');
}

export function createEngineSandboxPort(environment: ReviewIntentRuntimeEnvironment): SandboxPort {
  const adapter = new TensorlakeSandboxAdapter(environment);
  return createSandboxPort(adapter, {
    image: requireEnvironmentValue(environment.TRIBUNAL_SANDBOX_IMAGE, 'TRIBUNAL_SANDBOX_IMAGE'),
    proxyUrl: requireEnvironmentValue(environment.TRIBUNAL_PROXY_URL, 'TRIBUNAL_PROXY_URL'),
    proxyCidr: requireEnvironmentValue(environment.TRIBUNAL_PROXY_CIDR, 'TRIBUNAL_PROXY_CIDR'),
    enablePromptCaching1h: isEnabledFlag(environment.ENABLE_PROMPT_CACHING_1H),
  });
}

function isEnabledFlag(value: boolean | string | undefined): boolean {
  return value === true || value === 'true' || value === '1';
}

export function createDatabaseReviewWorkflowStatePort(database: Database): ReviewWorkflowStatePort {
  return {
    async loadPullRequestState(input: PullRequestReviewInput) {
      const rows = await database
        .select({ run: tribunalRun, review: pullRequestReviewRun })
        .from(pullRequestReviewRun)
        .innerJoin(tribunalRun, eq(tribunalRun.id, pullRequestReviewRun.runId))
        .where(
          and(
            eq(pullRequestReviewRun.repositoryId, input.repositoryId),
            eq(pullRequestReviewRun.prNumber, input.pullRequestNumber),
          ),
        )
        .orderBy(desc(tribunalRun.startedAt));

      if (rows.length === 0) {
        return { reviewRuns: [], agentRuns: [] };
      }

      const reviewRunIds = rows.map((row) => row.run.id);
      const agentRunRows = await database
        .select()
        .from(agentRun)
        .where(inArray(agentRun.runId, reviewRunIds));

      return {
        reviewRuns: rows.map((row) => toReviewRunRecord(row.run, row.review)),
        agentRuns: agentRunRows.map(toAgentRunRecord),
      };
    },
    // Runs a single multi-CTE statement so the parent (`tribunal_run`) and
    // child (`pull_request_review_run`) upserts stay atomic without an
    // explicit transaction (the neon-http driver used in production cannot
    // run interactive transactions). All CTEs see the pre-statement snapshot,
    // so `old_state` reads the row as it existed before this upsert even
    // though the two writes below use it as an input. This assumes a single
    // writer per run id (true today: one Weft workflow instance owns writes
    // for a given review run), so a stale read under concurrent writers to
    // the same run id is a known, accepted limitation rather than a bug.
    async upsertReviewRun(run: ReviewRunRecord) {
      const reviewPostClaimedAt = run.reviewPostClaimedAt ?? null;
      const finishedAt = run.finishedAt ?? null;
      const error = run.error ?? null;
      const costEstimateUsd = String(run.costEstimateUsd);

      await database.execute(sql`
        WITH old_state AS (
          SELECT
            ${tribunalRun.status} AS old_status,
            ${tribunalRun.finishedAt} AS old_finished_at,
            ${pullRequestReviewRun.commentsPosted} AS old_comments_posted,
            ${pullRequestReviewRun.reviewPostClaimedAt} AS old_review_post_claimed_at
          FROM ${tribunalRun}
          LEFT JOIN ${pullRequestReviewRun} ON ${pullRequestReviewRun.runId} = ${tribunalRun.id}
          WHERE ${tribunalRun.id} = ${run.id}
        ),
        parent_upsert AS (
          INSERT INTO ${tribunalRun} (
            "id", "user_id", "repository_id", "run_kind", "status", "workflow_id",
            "sandbox_id", "cost_estimate_usd", "started_at", "finished_at", "error"
          )
          VALUES (
            ${run.id}, ${run.userId}, ${run.repositoryId}, 'pull_request_review', ${run.status},
            ${run.workflowId}, ${run.sandboxId}, ${costEstimateUsd}, ${run.startedAt}, ${finishedAt}, ${error}
          )
          ON CONFLICT (id) DO UPDATE SET
            status = CASE
              WHEN ${run.status} IN ('cancelled', 'superseded')
              THEN ${run.status}
              WHEN (SELECT old_status FROM old_state) = 'posted'
                OR ${run.status} = 'posted'
                OR (SELECT old_comments_posted FROM old_state) > 0
                OR ${run.commentsPosted} > 0
              THEN 'posted'
              ELSE ${run.status}
            END,
            sandbox_id = ${run.sandboxId},
            cost_estimate_usd = ${costEstimateUsd},
            finished_at = CASE
              WHEN ${run.status} IN ('cancelled', 'superseded')
              THEN ${finishedAt}
              WHEN (SELECT old_status FROM old_state) = 'posted' AND (SELECT old_finished_at FROM old_state) IS NOT NULL
              THEN (SELECT old_finished_at FROM old_state)
              WHEN (SELECT old_comments_posted FROM old_state) > 0 AND (SELECT old_finished_at FROM old_state) IS NOT NULL
              THEN (SELECT old_finished_at FROM old_state)
              ELSE ${finishedAt}
            END,
            error = CASE
              WHEN ${run.status} IN ('cancelled', 'superseded')
              THEN ${error}
              WHEN (SELECT old_status FROM old_state) = 'posted'
                OR ${run.status} = 'posted'
                OR (SELECT old_comments_posted FROM old_state) > 0
                OR ${run.commentsPosted} > 0
              THEN NULL
              ELSE ${error}
            END
          RETURNING "id"
        ),
        child_upsert AS (
          INSERT INTO ${pullRequestReviewRun} (
            "run_id", "user_id", "repository_id", "pr_number", "head_sha", "prev_head_sha",
            "patch_id", "trigger", "check_run_id", "comments_posted", "review_post_claimed_at"
          )
          VALUES (
            ${run.id}, ${run.userId}, ${run.repositoryId}, ${run.pullRequestNumber}, ${run.headSha},
            ${run.previousHeadSha ?? null}, ${run.patchId ?? null}, ${run.trigger}, ${run.checkRunId ?? null},
            ${run.commentsPosted}, ${reviewPostClaimedAt}
          )
          ON CONFLICT (run_id) DO UPDATE SET
            patch_id = ${run.patchId ?? null},
            check_run_id = ${run.checkRunId ?? null},
            comments_posted = GREATEST(${pullRequestReviewRun.commentsPosted}, ${run.commentsPosted}),
            review_post_claimed_at = CASE
              WHEN (SELECT old_status FROM old_state) = 'posted'
                OR ${run.status} = 'posted'
                OR (SELECT old_comments_posted FROM old_state) > 0
                OR ${run.commentsPosted} > 0
              THEN NULL
              WHEN ${reviewPostClaimedAt}::timestamp with time zone IS NOT NULL
                AND (SELECT old_review_post_claimed_at FROM old_state) IS NULL
              THEN ${reviewPostClaimedAt}
              ELSE (SELECT old_review_post_claimed_at FROM old_state)
            END
          RETURNING "run_id"
        )
        SELECT 1 FROM parent_upsert, child_upsert
      `);
    },
    async claimReviewPost(reviewRunId: string, now: Date): Promise<ReviewPostClaimResult> {
      const claimedRows = await database
        .update(pullRequestReviewRun)
        .set({ reviewPostClaimedAt: now })
        .where(
          and(
            eq(pullRequestReviewRun.runId, reviewRunId),
            eq(pullRequestReviewRun.commentsPosted, 0),
            isNull(pullRequestReviewRun.reviewPostClaimedAt),
            sql`NOT EXISTS (
              SELECT 1 FROM ${tribunalRun}
              WHERE ${tribunalRun.id} = ${pullRequestReviewRun.runId} AND ${tribunalRun.status} = 'posted'
            )`,
          ),
        )
        .returning({ id: pullRequestReviewRun.runId });
      if (claimedRows.length > 0) return { status: 'claimed', claimedAt: now };

      const [existingRun] = await database
        .select({
          status: tribunalRun.status,
          commentsPosted: pullRequestReviewRun.commentsPosted,
          reviewPostClaimedAt: pullRequestReviewRun.reviewPostClaimedAt,
        })
        .from(pullRequestReviewRun)
        .innerJoin(tribunalRun, eq(tribunalRun.id, pullRequestReviewRun.runId))
        .where(eq(pullRequestReviewRun.runId, reviewRunId))
        .limit(1);

      if (
        existingRun !== undefined &&
        (existingRun.status === 'posted' || existingRun.commentsPosted > 0)
      ) {
        return { status: 'already_posted', commentsPosted: existingRun.commentsPosted };
      }

      return {
        status: 'claimed_by_other',
        claimedAt: existingRun?.reviewPostClaimedAt ?? undefined,
      };
    },
    async refreshReviewPostClaim(reviewRunId: string, claimedAt: Date, now: Date) {
      const rows = await database
        .update(pullRequestReviewRun)
        .set({ reviewPostClaimedAt: now })
        .where(
          and(
            eq(pullRequestReviewRun.runId, reviewRunId),
            eq(pullRequestReviewRun.commentsPosted, 0),
            eq(pullRequestReviewRun.reviewPostClaimedAt, claimedAt),
          ),
        )
        .returning({ reviewPostClaimedAt: pullRequestReviewRun.reviewPostClaimedAt });
      return rows[0]?.reviewPostClaimedAt ?? undefined;
    },
    async clearReviewPostClaim(reviewRunId: string, claimedAt: Date) {
      const rows = await database
        .update(pullRequestReviewRun)
        .set({ reviewPostClaimedAt: null })
        .where(
          and(
            eq(pullRequestReviewRun.runId, reviewRunId),
            eq(pullRequestReviewRun.commentsPosted, 0),
            eq(pullRequestReviewRun.reviewPostClaimedAt, claimedAt),
          ),
        )
        .returning({ id: pullRequestReviewRun.runId });
      return rows.length > 0;
    },
    async ownsReviewPostClaim(reviewRunId: string, claimedAt: Date) {
      const [existingRun] = await database
        .select({ id: pullRequestReviewRun.runId })
        .from(pullRequestReviewRun)
        .where(
          and(
            eq(pullRequestReviewRun.runId, reviewRunId),
            eq(pullRequestReviewRun.commentsPosted, 0),
            eq(pullRequestReviewRun.reviewPostClaimedAt, claimedAt),
          ),
        )
        .limit(1);
      return existingRun !== undefined;
    },
    async upsertAgentRun(run: AgentRunRecord) {
      await database
        .insert(agentRun)
        .values({
          id: run.id,
          userId: run.userId,
          runId: run.reviewRunId,
          agentId: run.agentId,
          role: run.role,
          modelUsed: run.modelUsed,
          effortUsed: run.effortUsed,
          status: run.status,
          findingsCount: run.findingsCount,
          inputTokens: run.usage?.inputTokens ?? 0,
          outputTokens: run.usage?.outputTokens ?? 0,
          cacheReadTokens: run.usage?.cacheReadTokens ?? 0,
          cacheCreationTokens: run.usage?.cacheCreationTokens ?? 0,
          costEstimateUsd: String(run.costEstimateUsd),
          durationMs: run.durationMs,
          stoppedReason: run.stoppedReason,
          error: run.error,
        })
        .onConflictDoUpdate({
          target: agentRun.id,
          set: {
            modelUsed: run.modelUsed,
            effortUsed: run.effortUsed,
            status: run.status,
            findingsCount: run.findingsCount,
            inputTokens: run.usage?.inputTokens ?? 0,
            outputTokens: run.usage?.outputTokens ?? 0,
            cacheReadTokens: run.usage?.cacheReadTokens ?? 0,
            cacheCreationTokens: run.usage?.cacheCreationTokens ?? 0,
            costEstimateUsd: String(run.costEstimateUsd),
            durationMs: run.durationMs,
            stoppedReason: run.stoppedReason,
            error: run.error,
          },
        });
    },
    async upsertAgentEvent(event) {
      await database
        .insert(agentEvent)
        .values({
          agentRunId: event.agentRunId,
          seq: event.seq,
          kind: event.kind,
          tool: event.tool,
          detail: event.detail ?? {},
          at: new Date(event.at),
        })
        .onConflictDoUpdate({
          target: [agentEvent.agentRunId, agentEvent.seq],
          set: {
            kind: event.kind,
            tool: event.tool,
            detail: event.detail ?? {},
            at: new Date(event.at),
          },
        });
    },
    async upsertFinding(findingRecord: FindingRecord) {
      await database
        .insert(finding)
        .values({
          id: findingRecord.id,
          userId: findingRecord.userId,
          agentRunId: findingRecord.agentRunId,
          path: findingRecord.path,
          startLine: findingRecord.startLine,
          endLine: findingRecord.endLine,
          side: findingRecord.side,
          severity: findingRecord.severity,
          title: findingRecord.title,
          body: findingRecord.body,
          suggestion: findingRecord.suggestion,
          anchored: findingRecord.anchored,
          githubCommentId: findingRecord.githubCommentId,
          fingerprint: findingRecord.fingerprint,
          verificationStatus: findingRecord.verificationStatus,
          verificationNote: findingRecord.verificationNote,
          verifierAgentRunId: findingRecord.verifierAgentRunId,
          mergedFingerprints: findingRecord.mergedFingerprints ?? [],
        })
        .onConflictDoUpdate({
          target: [finding.agentRunId, finding.fingerprint],
          set: {
            path: findingRecord.path,
            startLine: findingRecord.startLine,
            endLine: findingRecord.endLine,
            side: findingRecord.side,
            severity: findingRecord.severity,
            title: findingRecord.title,
            body: findingRecord.body,
            suggestion: findingRecord.suggestion,
            anchored: findingRecord.anchored,
            githubCommentId: findingRecord.githubCommentId,
            verificationStatus: findingRecord.verificationStatus,
            verificationNote: findingRecord.verificationNote,
            verifierAgentRunId: findingRecord.verifierAgentRunId,
            mergedFingerprints: findingRecord.mergedFingerprints ?? [],
          },
        });
    },
  };
}

function toReviewRunRecord(
  run: typeof tribunalRun.$inferSelect,
  review: typeof pullRequestReviewRun.$inferSelect,
): ReviewRunRecord {
  return {
    id: run.id,
    idempotencyKey: createReviewRunIdempotencyKey({
      repositoryId: review.repositoryId,
      pullRequestNumber: review.prNumber,
      headSha: review.headSha,
      trigger: review.trigger,
    }),
    workflowId:
      run.workflowId ??
      createPullRequestWorkflowId({
        repositoryId: review.repositoryId,
        pullRequestNumber: review.prNumber,
      }),
    userId: run.userId,
    repositoryId: review.repositoryId,
    pullRequestNumber: review.prNumber,
    headSha: review.headSha,
    previousHeadSha: review.prevHeadSha ?? undefined,
    patchId: review.patchId ?? undefined,
    trigger: review.trigger as ReviewRunRecord['trigger'],
    status: run.status as ReviewRunRecord['status'],
    sandboxId: run.sandboxId ?? '',
    checkRunId: review.checkRunId ?? undefined,
    commentsPosted: review.commentsPosted,
    reviewPostClaimedAt: review.reviewPostClaimedAt ?? undefined,
    costEstimateUsd: Number(run.costEstimateUsd),
    startedAt: run.startedAt ?? new Date(0),
    finishedAt: run.finishedAt ?? undefined,
    error: run.error ?? undefined,
  };
}

function toAgentRunRecord(row: typeof agentRun.$inferSelect): AgentRunRecord {
  return {
    id: row.id,
    idempotencyKey: `agent:${row.runId}:${row.agentId ?? row.id}`,
    reviewRunId: row.runId,
    userId: row.userId,
    agentId: row.agentId,
    role: row.role as AgentRunRecord['role'],
    status: row.status as AgentRunRecord['status'],
    findingsCount: row.findingsCount,
    costEstimateUsd: Number(row.costEstimateUsd),
    modelUsed: row.modelUsed ?? undefined,
    effortUsed: row.effortUsed as AgentRunRecord['effortUsed'],
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
    },
    durationMs: row.durationMs ?? undefined,
    stoppedReason: (row.stoppedReason ?? undefined) as AgentRunRecord['stoppedReason'],
    error: row.error ?? undefined,
  };
}

export class TensorlakeSandboxAdapter implements SandboxAdapter {
  private client: SandboxClient | undefined;
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly createPromises = new Map<string, Promise<{ sandboxId: string }>>();
  private readonly apiKey: string;
  private readonly organizationId: string | undefined;
  private readonly projectId: string | undefined;

  constructor(environment: ReviewIntentRuntimeEnvironment) {
    this.apiKey = requireEnvironmentValue(environment.TENSORLAKE_API_KEY, 'TENSORLAKE_API_KEY');
    this.organizationId = environment.TENSORLAKE_ORGANIZATION_ID;
    this.projectId = environment.TENSORLAKE_PROJECT_ID;
  }

  async create(input: SandboxCreateInput) {
    const existingPromise = this.createPromises.get(input.name);
    if (existingPromise !== undefined) return existingPromise;

    const promise = this.createOnce(input).finally(() => {
      this.createPromises.delete(input.name);
    });
    this.createPromises.set(input.name, promise);
    return promise;
  }

  private async createOnce(input: SandboxCreateInput) {
    const existing = await this.findSandboxByName(input.name);
    if (existing) {
      const verification = verifySandboxReuseIsolation(existing, {
        allowInternetAccess: false,
        allowOut: input.allowOut,
        secretNames: [],
      });
      if (!verification.ok) {
        throw new Error(`existing sandbox isolation could not be verified: ${verification.reason}`);
      }
      const sandbox = await Sandbox.connect({ sandboxId: existing.sandboxId, apiKey: this.apiKey });
      this.sandboxes.set(existing.sandboxId, sandbox);
      return { sandboxId: existing.sandboxId };
    }

    const created = await this.getClient().create({
      name: input.name,
      image: input.image,
      cpus: input.cpus,
      memoryMb: input.memoryMb,
      diskMb: input.diskMb,
      timeoutSecs: input.timeoutSecs,
      allowInternetAccess: input.allowInternetAccess,
      allowOut: input.allowOut,
    });
    const sandbox = await Sandbox.connect({
      sandboxId: created.sandboxId,
      apiKey: this.apiKey,
      organizationId: this.organizationId,
      projectId: this.projectId,
    });
    this.sandboxes.set(created.sandboxId, sandbox);
    return { sandboxId: created.sandboxId };
  }

  async runCommand(
    sandboxId: string,
    command: string,
    arguments_: string[],
    environment?: Record<string, string>,
  ) {
    const sandbox = await this.getSandbox(sandboxId);
    return sandbox.run(command, { args: arguments_, env: environment });
  }

  async runTrackedCommand(
    sandboxId: string,
    command: string,
    arguments_: string[],
    environment: Record<string, string> | undefined,
    onProcessStart: (processId: string) => Promise<void>,
    onStdoutLine?: (line: string) => void,
    signal?: AbortSignal,
  ) {
    const sandbox = await this.getSandbox(sandboxId);
    const process = await sandbox.startProcess(command, {
      args: arguments_,
      env: environment,
    });
    await onProcessStart(String(process.pid));

    const stdout: string[] = [];
    const stderr: string[] = [];
    let abortPromise: Promise<void> | undefined;
    const abort = async () => {
      try {
        await sandbox.killProcess(process.pid);
      } catch (error) {
        stderr.push(error instanceof Error ? error.message : 'Failed to kill sandbox process.');
      }
    };
    const abortListener = () => {
      abortPromise ??= abort();
    };
    signal?.addEventListener('abort', abortListener, { once: true });
    try {
      if (signal?.aborted) abortPromise ??= abort();
      for await (const event of sandbox.followOutput(process.pid)) {
        if (signal?.aborted) break;
        if (event.stream === 'stderr') {
          stderr.push(event.line);
        } else {
          stdout.push(event.line);
          onStdoutLine?.(event.line);
        }
      }
    } finally {
      await abortPromise;
      signal?.removeEventListener('abort', abortListener);
    }
    const completedProcess = await sandbox.getProcess(process.pid);
    const exitCode = completedProcess.exitCode;

    return {
      exitCode: typeof exitCode === 'number' ? exitCode : 1,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  async killProcess(sandboxId: string, processId: string) {
    const sandbox = await this.getSandbox(sandboxId);
    const pid = Number(processId);
    if (Number.isInteger(pid) && pid > 0) await sandbox.killProcess(pid);
  }

  async suspend(sandboxId: string) {
    const sandbox = await this.getSandbox(sandboxId);
    await sandbox.suspend();
  }

  async terminate(sandboxId: string) {
    const sandbox = await this.getSandbox(sandboxId);
    await sandbox.terminate();
    this.sandboxes.delete(sandboxId);
  }

  private async getSandbox(sandboxId: string): Promise<Sandbox> {
    const existing = this.sandboxes.get(sandboxId);
    if (existing) return existing;

    const sandbox = await Sandbox.connect({
      sandboxId,
      apiKey: this.apiKey,
      organizationId: this.organizationId,
      projectId: this.projectId,
    });
    this.sandboxes.set(sandboxId, sandbox);
    return sandbox;
  }

  private async findSandboxByName(name: string) {
    const sandboxes = await this.getClient().list();
    return sandboxes.find((sandbox) => sandbox.name === name && sandbox.status !== 'terminated');
  }

  private getClient(): SandboxClient {
    this.client ??= SandboxClient.forCloud({
      apiKey: this.apiKey,
      organizationId: this.organizationId,
      projectId: this.projectId,
    });
    return this.client;
  }
}

export async function resolveInstallationId(
  database: Database,
  repository: RepoRef,
): Promise<number> {
  const [row] = await database
    .select({ installationId: githubInstallation.installationId })
    .from(repositoryTable)
    .innerJoin(
      githubInstallationRepository,
      and(
        eq(githubInstallationRepository.repositoryId, repositoryTable.id),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    .innerJoin(
      githubInstallation,
      and(
        eq(githubInstallation.installationId, githubInstallationRepository.installationId),
        eq(githubInstallation.status, 'active'),
      ),
    )
    .where(
      and(eq(repositoryTable.owner, repository.owner), eq(repositoryTable.name, repository.name)),
    )
    .limit(1);

  if (!row) {
    throw new Error(
      `No active GitHub installation found for ${repository.owner}/${repository.name}.`,
    );
  }

  return row.installationId;
}

function normalizeFileStatus(status: string): DiffContext['changedFiles'][number]['status'] {
  if (status === 'added' || status === 'removed' || status === 'renamed') return status;
  return 'modified';
}

function requireEnvironmentValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for review intent processing.`);
  return value;
}

function parsePositiveNumber(
  value: number | string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  throw new Error(`${name} must be a positive number.`);
}

function parsePositiveInteger(
  value: number | string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;

  throw new Error(`${name} must be a positive integer.`);
}

function parseBooleanFlag(value: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}
