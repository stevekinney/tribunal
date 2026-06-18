import { createCostPort } from '@tribunal/cost';
import { createDatabase, type Database } from '@tribunal/database';
import { and, desc, eq, inArray, isNull, ne, sql } from '@tribunal/database/operators';
import {
  agentRun,
  githubInstallation,
  githubInstallationRepository,
  repository as repositoryTable,
  reviewRun,
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
import { createSandboxPort, type SandboxAdapter, type SandboxCreateInput } from '@tribunal/sandbox';
import { Sandbox, SandboxClient } from 'tensorlake';
import type {
  CheckRunPatch,
  DiffContext,
  GitHubPort,
  RepoRef,
  ReviewPayload,
  SandboxPort,
} from '@tribunal/review-core';
import { ReviewWorkflowEngine } from './review-workflow';
import { createDatabaseReviewIntentPort } from './review-intent-port';
import { createPullRequestWorkflowId, createReviewRunIdempotencyKey } from './identifiers';
import { createReviewWorkflowDefinitions } from './review-workflow-definitions';
import type {
  AgentRunRecord,
  ClaimedReviewIntent,
  PullRequestReviewInput,
  ReviewPostClaimResult,
  ReviewRunRecord,
  ReviewWorkflowStatePort,
} from './review-workflow';

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
  DEFAULT_DAILY_COST_CAP_USD?: string;
};

export const emptyUsageCostApiClient = {
  listReviewRunCosts: async () => [],
};

export const unconfiguredUsageCostApiClient = {
  listReviewRunCosts: async () => {
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
  const intentPort = createDatabaseReviewIntentPort(database, {
    defaultDailyCostCapUsd: parsePositiveNumber(environment.DEFAULT_DAILY_COST_CAP_USD, 25),
  });
  const reviewWorkflowEngine = new ReviewWorkflowEngine(
    {
      github: createEngineGitHubPort(database, githubContext),
      sandbox: createEngineSandboxPort(environment),
      cost: createCostPort(database, {
        usageCostApiClient: unconfiguredUsageCostApiClient,
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
          await dispatchReviewIntentWorkflow(workflowEngine, intent);
          await intentPort.markReviewIntentProcessed(intent.id, intent.claimedAt, new Date());
          processed += 1;
        } catch (error) {
          await intentPort.markReviewIntentFailed(intent.id, intent.claimedAt, new Date(), error);
        }
      }

      return processed;
    },
    stopReviewRun(reviewRunId: string) {
      return reviewWorkflowEngine.stopRun(reviewRunId, 'timeout');
    },
  };
}

type ReviewIntentWorkflowEngine = {
  start(
    workflowName: 'review-pr',
    intent: ClaimedReviewIntent,
    options: {
      id: string;
      onTerminalConflict: 'start-new';
      defer: false;
    },
  ): Promise<{ result(): Promise<unknown> }>;
};

async function dispatchReviewIntentWorkflow(
  workflowEngine: ReviewIntentWorkflowEngine,
  intent: ClaimedReviewIntent,
): Promise<void> {
  const handle = await workflowEngine.start('review-pr', intent, {
    id: createPullRequestWorkflowId({
      repositoryId: intent.pullRequest.repositoryId,
      pullRequestNumber: intent.pullRequest.pullRequestNumber,
    }),
    onTerminalConflict: 'start-new',
    defer: false,
  });
  await handle.result();
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
  };
}

export function createEngineGitHubPort(
  _database: Database,
  context: GithubServiceContext,
): GitHubPort {
  return {
    async mintReadToken(repositoryId: number, installationId: number) {
      const token = await mintSingleRepositoryReadToken(context, { installationId, repositoryId });
      return { token: token.token, expiresAt: new Date(token.expiresAt) };
    },
    async getDiffContext(
      repository: RepoRef,
      installationId: number,
      pullRequestNumber: number,
      head: string,
      previousHead?: string,
    ): Promise<DiffContext> {
      const [pullRequest, diffContext] = await Promise.all([
        getPullRequestMetadata(context, {
          installationId,
          owner: repository.owner,
          repository: repository.name,
          pullRequestNumber,
        }),
        getDiffContext(context, {
          installationId,
          owner: repository.owner,
          repository: repository.name,
          pullRequestNumber,
        }),
      ]);
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
    async createCheckRun(repository: RepoRef, installationId: number, headSha: string) {
      const checkRun = await createCheckRun(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        name: 'Tribunal',
        headSha,
      });
      return { checkRunId: checkRun.id };
    },
    async updateCheckRun(
      repository: RepoRef,
      installationId: number,
      checkRunId: number,
      patch: CheckRunPatch,
    ) {
      await updateCheckRun(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        checkRunId,
        ...patch,
        completedAt: patch.status === 'completed' ? new Date().toISOString() : undefined,
      });
    },
    async postReview(
      repository: RepoRef,
      installationId: number,
      pullRequestNumber: number,
      review: ReviewPayload,
    ) {
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
    async findPostedReview(
      repository: RepoRef,
      installationId: number,
      pullRequestNumber: number,
      reviewMarker: string,
    ) {
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

export function createEngineSandboxPort(environment: ReviewIntentRuntimeEnvironment): SandboxPort {
  const adapter = new TensorlakeSandboxAdapter(environment);
  return createSandboxPort(adapter, {
    image: requireEnvironmentValue(environment.TRIBUNAL_SANDBOX_IMAGE, 'TRIBUNAL_SANDBOX_IMAGE'),
    proxyUrl: requireEnvironmentValue(environment.TRIBUNAL_PROXY_URL, 'TRIBUNAL_PROXY_URL'),
    proxyCidr: requireEnvironmentValue(environment.TRIBUNAL_PROXY_CIDR, 'TRIBUNAL_PROXY_CIDR'),
  });
}

export function createDatabaseReviewWorkflowStatePort(database: Database): ReviewWorkflowStatePort {
  return {
    async loadPullRequestState(input: PullRequestReviewInput) {
      const reviewRunRows = await database
        .select()
        .from(reviewRun)
        .where(
          and(
            eq(reviewRun.repositoryId, input.repositoryId),
            eq(reviewRun.prNumber, input.pullRequestNumber),
          ),
        )
        .orderBy(desc(reviewRun.startedAt));

      if (reviewRunRows.length === 0) {
        return { reviewRuns: [], agentRuns: [] };
      }

      const reviewRunIds = reviewRunRows.map((row) => row.id);
      const agentRunRows = await database
        .select()
        .from(agentRun)
        .where(inArray(agentRun.reviewRunId, reviewRunIds));

      return {
        reviewRuns: reviewRunRows.map(toReviewRunRecord),
        agentRuns: agentRunRows.map(toAgentRunRecord),
      };
    },
    async upsertReviewRun(run: ReviewRunRecord) {
      await database
        .insert(reviewRun)
        .values({
          id: run.id,
          userId: run.userId,
          repositoryId: run.repositoryId,
          prNumber: run.pullRequestNumber,
          headSha: run.headSha,
          prevHeadSha: run.previousHeadSha,
          trigger: run.trigger,
          status: run.status,
          workflowId: run.workflowId,
          sandboxId: run.sandboxId,
          checkRunId: run.checkRunId,
          commentsPosted: run.commentsPosted,
          reviewPostClaimedAt: run.reviewPostClaimedAt ?? null,
          costEstimateUsd: String(run.costEstimateUsd),
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          error: run.error,
        })
        .onConflictDoUpdate({
          target: reviewRun.id,
          set: {
            status: sql`CASE
              WHEN ${reviewRun.status} = 'posted'
                OR ${run.status} = 'posted'
                OR ${reviewRun.commentsPosted} > 0
                OR ${run.commentsPosted} > 0
              THEN 'posted'
              ELSE ${run.status}
            END`,
            sandboxId: run.sandboxId,
            checkRunId: run.checkRunId,
            commentsPosted: sql`GREATEST(${reviewRun.commentsPosted}, ${run.commentsPosted})`,
            reviewPostClaimedAt: sql`CASE
              WHEN ${reviewRun.status} = 'posted'
                OR ${run.status} = 'posted'
                OR ${reviewRun.commentsPosted} > 0
                OR ${run.commentsPosted} > 0
              THEN NULL
              WHEN ${run.reviewPostClaimedAt ?? null}::timestamp with time zone IS NOT NULL
                AND ${reviewRun.reviewPostClaimedAt} IS NULL
              THEN ${run.reviewPostClaimedAt ?? null}
              ELSE ${reviewRun.reviewPostClaimedAt}
            END`,
            costEstimateUsd: String(run.costEstimateUsd),
            finishedAt: sql`CASE
              WHEN ${reviewRun.status} = 'posted' AND ${reviewRun.finishedAt} IS NOT NULL
              THEN ${reviewRun.finishedAt}
              WHEN ${reviewRun.commentsPosted} > 0 AND ${reviewRun.finishedAt} IS NOT NULL
              THEN ${reviewRun.finishedAt}
              ELSE ${run.finishedAt ?? null}
            END`,
            error: sql`CASE
              WHEN ${reviewRun.status} = 'posted'
                OR ${run.status} = 'posted'
                OR ${reviewRun.commentsPosted} > 0
                OR ${run.commentsPosted} > 0
              THEN NULL
              ELSE ${run.error ?? null}
            END`,
          },
        });
    },
    async claimReviewPost(reviewRunId: string, now: Date): Promise<ReviewPostClaimResult> {
      const claimedRows = await database
        .update(reviewRun)
        .set({ reviewPostClaimedAt: now })
        .where(
          and(
            eq(reviewRun.id, reviewRunId),
            eq(reviewRun.commentsPosted, 0),
            ne(reviewRun.status, 'posted'),
            isNull(reviewRun.reviewPostClaimedAt),
          ),
        )
        .returning({ id: reviewRun.id });
      if (claimedRows.length > 0) return { status: 'claimed', claimedAt: now };

      const [existingRun] = await database
        .select({
          status: reviewRun.status,
          commentsPosted: reviewRun.commentsPosted,
          reviewPostClaimedAt: reviewRun.reviewPostClaimedAt,
        })
        .from(reviewRun)
        .where(eq(reviewRun.id, reviewRunId))
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
        .update(reviewRun)
        .set({ reviewPostClaimedAt: now })
        .where(
          and(
            eq(reviewRun.id, reviewRunId),
            eq(reviewRun.commentsPosted, 0),
            eq(reviewRun.reviewPostClaimedAt, claimedAt),
          ),
        )
        .returning({ reviewPostClaimedAt: reviewRun.reviewPostClaimedAt });
      return rows[0]?.reviewPostClaimedAt ?? undefined;
    },
    async clearReviewPostClaim(reviewRunId: string, claimedAt: Date) {
      const rows = await database
        .update(reviewRun)
        .set({ reviewPostClaimedAt: null })
        .where(
          and(
            eq(reviewRun.id, reviewRunId),
            eq(reviewRun.commentsPosted, 0),
            eq(reviewRun.reviewPostClaimedAt, claimedAt),
          ),
        )
        .returning({ id: reviewRun.id });
      return rows.length > 0;
    },
    async ownsReviewPostClaim(reviewRunId: string, claimedAt: Date) {
      const [existingRun] = await database
        .select({ id: reviewRun.id })
        .from(reviewRun)
        .where(
          and(
            eq(reviewRun.id, reviewRunId),
            eq(reviewRun.commentsPosted, 0),
            eq(reviewRun.reviewPostClaimedAt, claimedAt),
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
          reviewRunId: run.reviewRunId,
          agentId: run.agentId,
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
  };
}

function toReviewRunRecord(row: typeof reviewRun.$inferSelect): ReviewRunRecord {
  return {
    id: row.id,
    idempotencyKey: createReviewRunIdempotencyKey({
      repositoryId: row.repositoryId,
      pullRequestNumber: row.prNumber,
      headSha: row.headSha,
      trigger: row.trigger,
    }),
    workflowId:
      row.workflowId ??
      createPullRequestWorkflowId({
        repositoryId: row.repositoryId,
        pullRequestNumber: row.prNumber,
      }),
    userId: row.userId,
    repositoryId: row.repositoryId,
    pullRequestNumber: row.prNumber,
    headSha: row.headSha,
    previousHeadSha: row.prevHeadSha ?? undefined,
    trigger: row.trigger as ReviewRunRecord['trigger'],
    status: row.status as ReviewRunRecord['status'],
    sandboxId: row.sandboxId ?? '',
    checkRunId: row.checkRunId ?? undefined,
    commentsPosted: row.commentsPosted,
    reviewPostClaimedAt: row.reviewPostClaimedAt ?? undefined,
    costEstimateUsd: Number(row.costEstimateUsd),
    startedAt: row.startedAt ?? new Date(0),
    finishedAt: row.finishedAt ?? undefined,
    error: row.error ?? undefined,
  };
}

function toAgentRunRecord(row: typeof agentRun.$inferSelect): AgentRunRecord {
  return {
    id: row.id,
    idempotencyKey: `agent:${row.reviewRunId}:${row.agentId}`,
    reviewRunId: row.reviewRunId,
    userId: row.userId,
    agentId: row.agentId,
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
  private readonly client: SandboxClient;
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly createPromises = new Map<string, Promise<{ sandboxId: string }>>();
  private readonly apiKey: string;
  private readonly organizationId: string | undefined;
  private readonly projectId: string | undefined;

  constructor(environment: ReviewIntentRuntimeEnvironment) {
    this.apiKey = requireEnvironmentValue(environment.TENSORLAKE_API_KEY, 'TENSORLAKE_API_KEY');
    this.organizationId = environment.TENSORLAKE_ORGANIZATION_ID;
    this.projectId = environment.TENSORLAKE_PROJECT_ID;
    this.client = SandboxClient.forCloud({
      apiKey: this.apiKey,
      organizationId: this.organizationId,
      projectId: this.projectId,
    });
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
      const sandbox = await Sandbox.connect({ sandboxId: existing.sandboxId, apiKey: this.apiKey });
      this.sandboxes.set(existing.sandboxId, sandbox);
      return { sandboxId: existing.sandboxId };
    }

    const created = await this.client.create({
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
  ) {
    const sandbox = await this.getSandbox(sandboxId);
    const process = await sandbox.startProcess(command, {
      args: arguments_,
      env: environment,
    });
    await onProcessStart(String(process.pid));

    const stdout: string[] = [];
    const stderr: string[] = [];
    for await (const event of sandbox.followOutput(process.pid)) {
      if (event.stream === 'stderr') {
        stderr.push(event.line);
      } else {
        stdout.push(event.line);
      }
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
    const sandboxes = await this.client.list();
    return sandboxes.find((sandbox) => sandbox.name === name && sandbox.status !== 'terminated');
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

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
