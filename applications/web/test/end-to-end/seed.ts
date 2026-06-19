/**
 * E2E Test Seeding Module
 *
 * Provides deterministic seeding functions for E2E tests.
 * These functions create real database records that can be used
 * in Playwright tests without requiring GitHub OAuth.
 *
 * IMPORTANT: This module should ONLY be used in E2E test mode.
 * The endpoints that use these functions are protected by E2E_TEST_MODE
 * and E2E_TEST_SECRET environment variables.
 */

import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import {
  agent,
  agentEvent,
  agentRun,
  costEvent,
  finding,
  githubInstallation,
  githubInstallationRepository,
  repository as repositoryTable,
  repositoryAgent,
  repositoryReviewSettings,
  reviewRun,
  user,
  userReviewSettings,
} from '@tribunal/database/schema';
import type * as schema from '@tribunal/database/schema';
import type { User, Repository } from '@tribunal/database/schema';

type E2EDatabase = PgliteDatabase<typeof schema>;

export interface SeedUserOptions {
  username?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  neonAuthUserId?: string;
}

export interface SeededUser {
  user: User;
  token: string;
}

export interface SeedRepositoryOptions {
  id?: number;
  owner?: string;
  name?: string;
  installationId?: number | null;
  uri?: string;
}

export interface SeededRepository {
  repository: Repository;
}

export interface SeedOperatorDataOptions {
  userId: number;
  repositoryId: number;
}

export interface FakeReviewLifecycleInput {
  userId: number;
  repositoryId: number;
  pullRequestNumber?: number;
  headSha?: string;
  deliveryId?: string;
  kind?: 'opened' | 'synchronize' | 'closed' | 'redelivered';
}

// Per-worker counters for unique ID generation within a test run
// Each worker maintains its own counter for parallel test isolation
const workerSeedCounters = new Map<string, number>();
const DEFAULT_WORKER_ID = 'default';

/**
 * Gets the next seed ID for a worker (thread-safe within a single process)
 */
function getNextSeedId(workerId?: string): number {
  const id = workerId ?? DEFAULT_WORKER_ID;
  const current = workerSeedCounters.get(id) ?? 1;
  workerSeedCounters.set(id, current + 1);
  return current;
}

/**
 * Reset the seed counter for a specific worker (called during E2E reset)
 */
export function resetSeedCounter(workerId?: string): void {
  const id = workerId ?? DEFAULT_WORKER_ID;
  workerSeedCounters.set(id, 1);
}

/**
 * Seeds a test user with a valid test-only Neon Auth bridge token.
 *
 * This creates:
 * - A user record in the database
 * - A Neon Auth user mapping
 * - Returns the raw E2E token for cookie setting
 *
 * @param db - The E2E database instance
 * @param options - Optional overrides for user properties
 * @param workerId - Worker ID for per-worker seed counter isolation
 * @returns The created user and raw token
 */
export async function seedE2EUser(
  db: E2EDatabase,
  options: SeedUserOptions = {},
  workerId?: string,
): Promise<SeededUser> {
  const id = getNextSeedId(workerId);

  // Create user
  const neonAuthUserId =
    options.neonAuthUserId ?? `e2e-neon-user-${workerId ?? DEFAULT_WORKER_ID}-${id}`;
  const [createdUser] = await db
    .insert(user)
    .values({
      username: options.username ?? `e2e-user-${id}`,
      neonAuthUserId,
      name: options.name ?? `E2E Test User ${id}`,
      email: options.email ?? `e2e-user-${id}@test.local`,
      avatarUrl: options.avatarUrl ?? `https://api.dicebear.com/7.x/identicon/svg?seed=e2e-${id}`,
    })
    .returning();

  const token = `e2e:${workerId ?? DEFAULT_WORKER_ID}:${createdUser.id}:${crypto.randomUUID()}`;

  return { user: createdUser, token };
}

/**
 * Seeds a repository in the flat data model.
 *
 * @param db - The E2E database instance
 * @param options - Optional overrides for repository properties
 * @param workerId - Worker ID for per-worker seed counter isolation
 * @returns The created repository
 */
export async function seedRepository(
  db: E2EDatabase,
  options: SeedRepositoryOptions = {},
  workerId?: string,
): Promise<SeededRepository> {
  const id = getNextSeedId(workerId);
  const repositoryId = options.id ?? 200000000 + id;
  const owner = options.owner ?? `e2e-owner-${id}`;
  const name = options.name ?? `e2e-repository-${id}`;

  const [repository] = await db
    .insert(repositoryTable)
    .values({
      id: repositoryId,
      owner,
      name,
      uri: options.uri ?? `https://github.com/${owner}/${name}.git`,
      installationId: options.installationId ?? 1,
    })
    .returning();

  return { repository };
}

export async function seedOperatorData(
  db: E2EDatabase,
  options: SeedOperatorDataOptions,
): Promise<void> {
  const installationId = 900_000 + options.userId;
  const agentId = `agent-e2e-${options.userId}`;
  const reviewRunId = `run-e2e-${options.repositoryId}-17-opened`;
  const agentRunId = `agent-run-e2e-${options.repositoryId}-security`;
  const now = new Date('2026-06-19T12:00:00.000Z');

  await db
    .insert(githubInstallation)
    .values({
      installationId,
      userId: options.userId,
      accountLogin: 'e2e-organization',
      accountType: 'Organization',
      accountId: 800_000 + options.userId,
      repositorySelection: 'selected',
      status: 'active',
      syncStatus: 'idle',
    })
    .onConflictDoNothing();

  await db
    .insert(githubInstallationRepository)
    .values({
      installationId,
      repositoryId: options.repositoryId,
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(agent)
    .values({
      id: agentId,
      userId: options.userId,
      slug: 'security-review',
      description: 'Finds authentication and permission issues',
      body: 'Review the pull request for security issues.',
      model: 'sonnet',
      effort: 'medium',
      enabled: true,
    })
    .onConflictDoNothing();

  await db
    .insert(repositoryReviewSettings)
    .values({
      repositoryId: options.repositoryId,
      watched: true,
      ignoreGlobs: ['dist/**'],
    })
    .onConflictDoUpdate({
      target: repositoryReviewSettings.repositoryId,
      set: { watched: true, ignoreGlobs: ['dist/**'], updatedAt: now },
    });

  await db
    .insert(repositoryAgent)
    .values({ repositoryId: options.repositoryId, agentId })
    .onConflictDoNothing();

  await db
    .insert(userReviewSettings)
    .values({
      userId: options.userId,
      dailyCostCapUsd: '25',
      reviewsEnabled: true,
      defaultModel: 'sonnet',
    })
    .onConflictDoUpdate({
      target: userReviewSettings.userId,
      set: { dailyCostCapUsd: '25', reviewsEnabled: true, defaultModel: 'sonnet', updatedAt: now },
    });

  await db
    .insert(reviewRun)
    .values({
      id: reviewRunId,
      userId: options.userId,
      repositoryId: options.repositoryId,
      prNumber: 17,
      headSha: 'e2e-open-sha',
      trigger: 'opened',
      status: 'posted',
      workflowId: `review:pr:${options.repositoryId}:17`,
      sandboxId: `sandbox-${options.repositoryId}-17`,
      checkRunId: 700_017,
      commentsPosted: 1,
      costEstimateUsd: '0.42',
      startedAt: now,
      finishedAt: new Date('2026-06-19T12:01:00.000Z'),
    })
    .onConflictDoNothing();

  await db
    .insert(agentRun)
    .values({
      id: agentRunId,
      userId: options.userId,
      reviewRunId,
      agentId,
      modelUsed: 'sonnet',
      effortUsed: 'medium',
      status: 'succeeded',
      findingsCount: 1,
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 200,
      cacheCreationTokens: 50,
      costEstimateUsd: '0.42',
      durationMs: 1400,
    })
    .onConflictDoNothing();

  await db
    .insert(finding)
    .values({
      id: `finding-e2e-${options.repositoryId}-security`,
      userId: options.userId,
      agentRunId,
      path: 'src/authentication.ts',
      startLine: 12,
      endLine: 14,
      side: 'RIGHT',
      severity: 'warning',
      title: 'Validate authorization before reading repository data',
      body: 'The fake review found an authorization boundary worth checking.',
      anchored: true,
      fingerprint: `fingerprint-e2e-${options.repositoryId}-security`,
    })
    .onConflictDoNothing();

  await db
    .insert(agentEvent)
    .values({
      agentRunId,
      seq: 1,
      kind: 'session_start',
      detail: { model: 'sonnet' },
      at: now,
    })
    .onConflictDoNothing();

  await db
    .insert(costEvent)
    .values({
      id: `cost-e2e-${reviewRunId}`,
      userId: options.userId,
      kind: 'llm',
      source: 'estimate',
      repositoryId: options.repositoryId,
      reviewRunId,
      agentRunId,
      agentId,
      amountUsd: '0.42',
      meta: { cacheReadTokens: 200, cacheCreationTokens: 50 },
      occurredAt: now,
      idempotencyKey: `llm:${agentRunId}:estimate`,
    })
    .onConflictDoNothing();
}

export async function applyFakeReviewLifecycleEvent(
  db: E2EDatabase,
  input: FakeReviewLifecycleInput,
): Promise<{
  runId: string;
  status: string;
  duplicateCostEvents: number;
  totalCostUsd: number;
}> {
  const pullRequestNumber = input.pullRequestNumber ?? 17;
  const headSha = input.headSha ?? 'e2e-open-sha';
  const kind = input.kind ?? 'opened';
  const trigger = kind === 'synchronize' ? 'synchronize' : 'opened';
  const runId = `run-e2e-${input.repositoryId}-${pullRequestNumber}-${headSha}-${trigger}`;
  const agentId = `agent-e2e-${input.userId}`;
  const agentRunId = `agent-run-e2e-${input.repositoryId}-${pullRequestNumber}-${headSha}`;
  const deliveryId = input.deliveryId ?? `delivery-${kind}-${headSha}`;
  const now = new Date('2026-06-19T12:05:00.000Z');

  if (kind === 'closed') {
    await db
      .update(reviewRun)
      .set({
        status: 'cancelled',
        finishedAt: now,
        error: 'Pull request closed in fake E2E lifecycle.',
      })
      .where(eq(reviewRun.repositoryId, input.repositoryId));

    await db
      .update(agentRun)
      .set({ status: 'cancelled', stoppedReason: 'pr_closed' })
      .where(eq(agentRun.userId, input.userId));
  } else {
    if (kind === 'synchronize') {
      await db
        .update(reviewRun)
        .set({ status: 'superseded', finishedAt: now })
        .where(eq(reviewRun.repositoryId, input.repositoryId));
    }

    await db
      .insert(reviewRun)
      .values({
        id: runId,
        userId: input.userId,
        repositoryId: input.repositoryId,
        prNumber: pullRequestNumber,
        headSha,
        prevHeadSha: kind === 'synchronize' ? 'e2e-open-sha' : null,
        trigger,
        status: 'posted',
        workflowId: `review:pr:${input.repositoryId}:${pullRequestNumber}`,
        sandboxId: `sandbox-${input.repositoryId}-${pullRequestNumber}`,
        checkRunId: 710_000 + pullRequestNumber,
        commentsPosted: 1,
        costEstimateUsd: '0.31',
        startedAt: now,
        finishedAt: new Date('2026-06-19T12:06:00.000Z'),
      })
      .onConflictDoNothing();

    await db
      .insert(agentRun)
      .values({
        id: agentRunId,
        userId: input.userId,
        reviewRunId: runId,
        agentId,
        modelUsed: 'sonnet',
        effortUsed: 'medium',
        status: 'succeeded',
        findingsCount: 1,
        inputTokens: 900,
        outputTokens: 180,
        costEstimateUsd: '0.31',
        durationMs: 1100,
      })
      .onConflictDoNothing();

    await db
      .insert(costEvent)
      .values({
        id: `cost-e2e-${deliveryId}`,
        userId: input.userId,
        kind: 'llm',
        source: 'estimate',
        repositoryId: input.repositoryId,
        reviewRunId: runId,
        agentRunId,
        agentId,
        amountUsd: '0.31',
        meta: { deliveryId },
        occurredAt: now,
        idempotencyKey: `fake-review:${deliveryId}:cost`,
      })
      .onConflictDoNothing();
  }

  const costRows = await db
    .select()
    .from(costEvent)
    .where(eq(costEvent.repositoryId, input.repositoryId));
  const costKeys = new Map<string, number>();
  for (const event of costRows) {
    costKeys.set(event.idempotencyKey, (costKeys.get(event.idempotencyKey) ?? 0) + 1);
  }

  const [currentRun] = await db.select().from(reviewRun).where(eq(reviewRun.id, runId)).limit(1);

  return {
    runId,
    status: currentRun?.status ?? 'closed',
    duplicateCostEvents: Array.from(costKeys.values()).filter((count) => count > 1).length,
    totalCostUsd: costRows.reduce((sum, row) => sum + Number(row.amountUsd), 0),
  };
}

/**
 * Gets the E2E database instance for a specific worker.
 * This function throws if called outside of E2E mode.
 *
 * @param workerId - The worker ID (from Playwright's TEST_WORKER_INDEX or request header)
 */
export async function getE2EDatabase(workerId?: string): Promise<E2EDatabase> {
  // Dynamic import to avoid loading PGlite in production
  const { getE2EDatabaseInstance } = await import('$testing/end-to-end/database');
  return getE2EDatabaseInstance(workerId);
}
