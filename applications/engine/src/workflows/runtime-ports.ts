import { createCostPort } from '@tribunal/cost';
import { createDatabase, type Database } from '@tribunal/database';
import { and, eq } from '@tribunal/database/operators';
import {
  githubInstallation,
  githubInstallationRepository,
  repository as repositoryTable,
} from '@tribunal/database/schema';
import { createGithubApplicationSingleton } from '@tribunal/github';
import { createCache } from '@tribunal/github/cache';
import { createCheckRun, updateCheckRun } from '@tribunal/github/reviews/check-runs';
import { getDiffContext, getPullRequestMetadata } from '@tribunal/github/reviews/diff-context';
import { mintSingleRepositoryReadToken } from '@tribunal/github/reviews/read-tokens';
import { postPullRequestReview } from '@tribunal/github/reviews/pull-request-reviews';
import type { GithubServiceContext } from '@tribunal/github/context';
import { createSandboxPort, type SandboxAdapter, type SandboxCreateInput } from '@tribunal/sandbox';
import { Sandbox, SandboxClient } from 'tensorlake';
import type {
  AgentSpec,
  CheckRunPatch,
  DiffContext,
  GitHubPort,
  RepoRef,
  ReviewPayload,
  SandboxPort,
} from '@tribunal/review-core';
import { ReviewWorkflowEngine } from './review-workflow';
import { createDatabaseReviewIntentPort } from './review-intent-port';
import { createPullRequestWorkflowId } from './identifiers';
import { createReviewWorkflowDefinitions } from './review-workflow-definitions';
import type { ClaimedReviewIntent } from './review-workflow';

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
  MAX_CONCURRENT_AGENTS?: string;
  DEFAULT_DAILY_COST_CAP_USD?: string;
};

export const emptyUsageCostApiClient = {
  listReviewRunCosts: async () => [],
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
        usageCostApiClient: emptyUsageCostApiClient,
      }),
      intents: intentPort,
    },
    {
      sandboxImage: requireEnvironmentValue(
        environment.TRIBUNAL_SANDBOX_IMAGE,
        'TRIBUNAL_SANDBOX_IMAGE',
      ),
      proxyUrl: requireEnvironmentValue(environment.TRIBUNAL_PROXY_URL, 'TRIBUNAL_PROXY_URL'),
      proxySigningKey: requireEnvironmentValue(environment.PROXY_SIGNING_KEY, 'PROXY_SIGNING_KEY'),
      runTokenTtlSeconds: 60 * 60,
      maxConcurrentAgents: parsePositiveInteger(environment.MAX_CONCURRENT_AGENTS, 3),
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
          throw error;
        }
      }

      return processed;
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
  database: Database,
  context: GithubServiceContext,
): GitHubPort {
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
      const installationId = await resolveInstallationId(database, repository);
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
    async createCheckRun(repository: RepoRef, headSha: string) {
      const installationId = await resolveInstallationId(database, repository);
      const checkRun = await createCheckRun(context, {
        installationId,
        owner: repository.owner,
        repository: repository.name,
        name: 'Tribunal',
        headSha,
      });
      return { checkRunId: checkRun.id };
    },
    async updateCheckRun(repository: RepoRef, checkRunId: number, patch: CheckRunPatch) {
      const installationId = await resolveInstallationId(database, repository);
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
      const installationId = await resolveInstallationId(database, repository);
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

export class TensorlakeSandboxAdapter implements SandboxAdapter {
  private readonly client: SandboxClient;
  private readonly sandboxes = new Map<string, Sandbox>();
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

    return {
      exitCode: completedProcess.exitCode ?? 0,
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
      eq(githubInstallation.installationId, githubInstallationRepository.installationId),
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
