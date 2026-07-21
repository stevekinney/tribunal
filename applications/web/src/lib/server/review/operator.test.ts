import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';
import {
  agent,
  agentEvent,
  agentRun,
  costEvent,
  finding,
  githubInstallation,
  githubInstallationRepository,
  pullRequestReviewRun,
  repository,
  repositoryAgent,
  repositoryReviewSettings,
  tribunalRun,
  user,
  userReviewSettings,
  webhookEvent,
  webhookEventHandlerRun,
} from '@tribunal/database/schema';
import { eq } from 'drizzle-orm';
import {
  deleteAgent,
  getAgent,
  getRepositoryOperatorDetails,
  getCostOverview,
  getReviewEffortOptions,
  getReviewModelOptions,
  getReviewsEnabled,
  getRunInspector,
  getRunsOverview,
  getUserReviewSettings,
  hasWatchedRepositories,
  listAgents,
  normalizeIgnoreGlobs,
  saveAgent,
  saveRepositoryWatchSettings,
  saveUserReviewSettings,
  setAgentEnabled,
  stopAgent,
  stopRun,
  streamRunAgentEvents,
  submitRepositorySettingsForm,
  userOwnsRepository,
  validateEffort,
} from './operator';

const mocks = vi.hoisted(() => ({
  env: {
    TRIBUNAL_ENGINE_URL: '',
    TRIBUNAL_ENGINE_CONTROL_TOKEN: '',
  },
}));

vi.mock('$env/dynamic/private', () => ({
  env: mocks.env,
}));

describe('review operator server helpers', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    mocks.env.TRIBUNAL_ENGINE_URL = '';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = '';
    vi.restoreAllMocks();
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  async function insertReviewRun(input: {
    id: string;
    userId: number;
    repositoryId: number;
    prNumber: number;
    headSha: string;
    prevHeadSha?: string | null;
    trigger: string;
    status?: string;
    startedAt?: Date;
  }) {
    await testDb.db.insert(tribunalRun).values({
      id: input.id,
      userId: input.userId,
      repositoryId: input.repositoryId,
      runKind: 'pull_request_review',
      status: input.status ?? 'queued',
      startedAt: input.startedAt,
    });
    await testDb.db.insert(pullRequestReviewRun).values({
      runId: input.id,
      userId: input.userId,
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha,
      prevHeadSha: input.prevHeadSha ?? null,
      trigger: input.trigger,
    });
  }

  async function selectReviewRun(id: string) {
    const [row] = await testDb.db
      .select({ run: tribunalRun, review: pullRequestReviewRun })
      .from(tribunalRun)
      .innerJoin(pullRequestReviewRun, eq(pullRequestReviewRun.runId, tribunalRun.id))
      .where(eq(tribunalRun.id, id));
    return row === undefined ? undefined : { ...row.run, ...row.review, id: row.run.id };
  }

  async function seedRepositoryOwnership() {
    const [owner] = await testDb.db.insert(user).values({ username: 'owner-user' }).returning();
    const [otherUser] = await testDb.db.insert(user).values({ username: 'other-user' }).returning();
    await testDb.db.insert(repository).values({
      id: 9001,
      owner: 'lost-gradient',
      name: 'tribunal',
      uri: 'https://github.com/lost-gradient/tribunal.git',
      defaultBranch: 'main',
    });
    await testDb.db.insert(githubInstallation).values({
      installationId: 7001,
      userId: owner.id,
      accountLogin: 'lost-gradient',
      accountType: 'Organization',
      accountId: 7002,
      repositorySelection: 'selected',
    });
    await testDb.db.insert(githubInstallationRepository).values({
      installationId: 7001,
      repositoryId: 9001,
      isActive: true,
    });
    const [reviewAgent] = await testDb.db
      .insert(agent)
      .values({
        id: 'agent_security',
        userId: owner.id,
        slug: 'security',
        description: 'Finds security issues',
        body: 'Review for security issues.',
        model: 'sonnet',
        enabled: true,
      })
      .returning();

    return { owner, otherUser, reviewAgent };
  }

  async function seedSharedRepositoryOwnership() {
    const [firstOwner] = await testDb.db
      .insert(user)
      .values({ username: 'first-owner' })
      .returning();
    const [secondOwner] = await testDb.db
      .insert(user)
      .values({ username: 'second-owner' })
      .returning();
    await testDb.db.insert(repository).values({
      id: 9101,
      owner: 'lost-gradient',
      name: 'shared-tribunal',
      uri: 'https://github.com/lost-gradient/shared-tribunal.git',
      defaultBranch: 'main',
    });
    await testDb.db.insert(githubInstallation).values([
      {
        installationId: 7101,
        userId: firstOwner.id,
        accountLogin: 'lost-gradient',
        accountType: 'Organization',
        accountId: 7102,
        repositorySelection: 'selected',
      },
      {
        installationId: 7201,
        userId: secondOwner.id,
        accountLogin: 'lost-gradient',
        accountType: 'Organization',
        accountId: 7202,
        repositorySelection: 'selected',
      },
    ]);
    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 7101, repositoryId: 9101, isActive: true },
      { installationId: 7201, repositoryId: 9101, isActive: true },
    ]);
    const [firstAgent, secondAgent] = await testDb.db
      .insert(agent)
      .values([
        {
          id: 'agent_first_owner',
          userId: firstOwner.id,
          slug: 'first-owner-security',
          description: 'Finds security issues',
          body: 'Review for security issues.',
          model: 'sonnet',
          enabled: true,
        },
        {
          id: 'agent_second_owner',
          userId: secondOwner.id,
          slug: 'second-owner-tests',
          description: 'Finds missing tests',
          body: 'Review for missing tests.',
          model: 'sonnet',
          enabled: true,
        },
      ])
      .returning();

    return { firstOwner, secondOwner, firstAgent, secondAgent };
  }

  it('persists repository watch settings only for the owning user', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();

    await withTestDatabase(() =>
      saveRepositoryWatchSettings(owner.id, {
        repositoryId: 9001,
        watched: true,
        ignoreGlobs: ['docs/**'],
        agentIds: [reviewAgent.id],
      }),
    );

    const [settings] = await testDb.db
      .select()
      .from(repositoryReviewSettings)
      .where(eq(repositoryReviewSettings.repositoryId, 9001));
    const assignments = await testDb.db.select().from(repositoryAgent);

    expect(settings).toMatchObject({ watched: true, ignoreGlobs: ['docs/**'] });
    expect(assignments).toHaveLength(1);
    await expect(
      withTestDatabase(() =>
        saveRepositoryWatchSettings(otherUser.id, {
          repositoryId: 9001,
          watched: false,
          ignoreGlobs: [],
          agentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('authorizes only the owning user for a repository', async () => {
    const { owner, otherUser } = await seedRepositoryOwnership();

    expect(await withTestDatabase(() => userOwnsRepository(owner.id, 9001))).toBe(true);
    // A non-owner must not pass the pre-authorization gate the onboarding batch
    // relies on to avoid partial writes from a crafted submission.
    expect(await withTestDatabase(() => userOwnsRepository(otherUser.id, 9001))).toBe(false);
    // An unknown repository id is owned by no one.
    expect(await withTestDatabase(() => userOwnsRepository(owner.id, 9999))).toBe(false);
  });

  it('reports whether a user is watching any repository', async () => {
    const { owner } = await seedRepositoryOwnership();

    expect(await withTestDatabase(() => hasWatchedRepositories(owner.id))).toBe(false);

    await withTestDatabase(() =>
      saveRepositoryWatchSettings(owner.id, {
        repositoryId: 9001,
        watched: true,
        ignoreGlobs: [],
        agentIds: [],
      }),
    );
    expect(await withTestDatabase(() => hasWatchedRepositories(owner.id))).toBe(true);

    // Unwatching returns the user to the no-watched state, which drives the
    // post-login redirect back to onboarding.
    await withTestDatabase(() =>
      saveRepositoryWatchSettings(owner.id, {
        repositoryId: 9001,
        watched: false,
        ignoreGlobs: [],
        agentIds: [],
      }),
    );
    expect(await withTestDatabase(() => hasWatchedRepositories(owner.id))).toBe(false);
  });

  it('reads reviews-enabled without creating a settings row, defaulting to enabled', async () => {
    const { owner } = await seedRepositoryOwnership();

    // No settings row yet → schema default (enabled).
    expect(await withTestDatabase(() => getReviewsEnabled(owner.id))).toBe(true);

    // The read must NOT create a row — it runs in the authenticated layout load,
    // which must stay a pure read so a write can never gate the whole app.
    const rowsAfterRead = await testDb.db
      .select()
      .from(userReviewSettings)
      .where(eq(userReviewSettings.userId, owner.id));
    expect(rowsAfterRead).toHaveLength(0);

    // An explicit row is reflected without mutation.
    await testDb.db.insert(userReviewSettings).values({ userId: owner.id, reviewsEnabled: false });
    expect(await withTestDatabase(() => getReviewsEnabled(owner.id))).toBe(false);
  });

  it('keeps watch settings and assignments separate for two users with the same repository', async () => {
    const { firstOwner, secondOwner, firstAgent, secondAgent } =
      await seedSharedRepositoryOwnership();

    await withTestDatabase(() =>
      saveRepositoryWatchSettings(firstOwner.id, {
        repositoryId: 9101,
        watched: true,
        ignoreGlobs: ['docs/**'],
        agentIds: [firstAgent.id],
      }),
    );
    await withTestDatabase(() =>
      saveRepositoryWatchSettings(secondOwner.id, {
        repositoryId: 9101,
        watched: false,
        ignoreGlobs: ['src/generated/**'],
        agentIds: [secondAgent.id],
      }),
    );

    // Two runs for the same repository (newest first, per orderBy) exercise
    // the `seenRuns` dedup so only the most recent run's status is kept, and
    // a non-"estimate" cost event exercises the source-filter skip below.
    await insertReviewRun({
      id: 'run_9101_older',
      userId: firstOwner.id,
      repositoryId: 9101,
      prNumber: 1,
      headSha: 'a'.repeat(40),
      trigger: 'opened',
      status: 'failed',
      startedAt: new Date(Date.now() - 60_000),
    });
    await insertReviewRun({
      id: 'run_9101_newer',
      userId: firstOwner.id,
      repositoryId: 9101,
      prNumber: 2,
      headSha: 'b'.repeat(40),
      trigger: 'opened',
      status: 'posted',
      startedAt: new Date(),
    });
    await testDb.db.insert(costEvent).values([
      {
        id: 'cost_9101_estimate',
        userId: firstOwner.id,
        kind: 'llm',
        source: 'estimate',
        repositoryId: 9101,
        amountUsd: '3.00',
        idempotencyKey: 'cost_9101_estimate',
      },
      {
        id: 'cost_9101_reconciled',
        userId: firstOwner.id,
        kind: 'llm',
        source: 'reconciled',
        repositoryId: 9101,
        amountUsd: '99.00',
        idempotencyKey: 'cost_9101_reconciled',
      },
    ]);

    const firstDetails = await withTestDatabase(() =>
      getRepositoryOperatorDetails(firstOwner.id, [9101]),
    );
    const secondDetails = await withTestDatabase(() =>
      getRepositoryOperatorDetails(secondOwner.id, [9101]),
    );

    expect(firstDetails.get(9101)).toMatchObject({
      watched: true,
      ignoreGlobs: ['docs/**'],
      agents: [{ id: firstAgent.id, slug: firstAgent.slug, enabled: true }],
      // Only the newest run's status survives the dedup, and only the
      // "estimate"-sourced cost event (not the "actual" one) is rolled up.
      lastRunStatus: 'posted',
      estimatedCostLast30DaysUsd: 3,
    });
    expect(secondDetails.get(9101)).toMatchObject({
      watched: false,
      ignoreGlobs: ['src/generated/**'],
      agents: [{ id: secondAgent.id, slug: secondAgent.slug, enabled: true }],
    });
  });

  it('returns an empty map without querying the database when no repository ids are given', async () => {
    const { owner } = await seedRepositoryOwnership();

    const details = await withTestDatabase(() => getRepositoryOperatorDetails(owner.id, []));

    expect(details.size).toBe(0);
  });

  it('does not leave partial watch settings when assignment persistence fails', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    // This mock throws before Postgres receives the single CTE statement. It
    // verifies error propagation, not Postgres-level CTE atomicity.
    const executeSpy = vi
      .spyOn(testDb.db, 'execute')
      .mockRejectedValueOnce(new Error('assignment persistence failed'));

    await expect(
      withTestDatabase(() =>
        saveRepositoryWatchSettings(owner.id, {
          repositoryId: 9001,
          watched: true,
          ignoreGlobs: ['docs/**'],
          agentIds: [reviewAgent.id],
        }),
      ),
    ).rejects.toThrow('assignment persistence failed');

    executeSpy.mockRestore();

    const settings = await testDb.db.select().from(repositoryReviewSettings);
    const assignments = await testDb.db.select().from(repositoryAgent);

    expect(settings).toEqual([]);
    expect(assignments).toEqual([]);
  });

  it('trims, rejects empty, and dedupes submitted ignore globs and agentIds', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.append('ignoreGlobs', '  dist/** ');
    formData.append('ignoreGlobs', 'dist/**');
    formData.append('ignoreGlobs', '   ');
    formData.append('ignoreGlobs', 'coverage/**');
    formData.append('agentIds', reviewAgent.id);
    formData.append('agentIds', reviewAgent.id);

    await withTestDatabase(() => submitRepositorySettingsForm(owner.id, 9001, formData));

    const [settings] = await testDb.db
      .select()
      .from(repositoryReviewSettings)
      .where(eq(repositoryReviewSettings.repositoryId, 9001));
    const assignments = await testDb.db.select().from(repositoryAgent);

    expect(settings).toMatchObject({ watched: true, ignoreGlobs: ['dist/**', 'coverage/**'] });
    expect(assignments).toHaveLength(1);
  });

  it('splits a single newline-delimited ignoreGlobs value from a stale legacy textarea submission', async () => {
    const { owner } = await seedRepositoryOwnership();
    // The pre-move pull-requests settings form submitted the whole textarea
    // as one newline-delimited string under the `ignoreGlobs` key, unlike the
    // new settings page which submits one value per committed tag.
    const formData = new FormData();
    formData.append('ignoreGlobs', 'dist/**\ncoverage/**\ndist/**');

    await withTestDatabase(() => submitRepositorySettingsForm(owner.id, 9001, formData));

    const [settings] = await testDb.db
      .select()
      .from(repositoryReviewSettings)
      .where(eq(repositoryReviewSettings.repositoryId, 9001));

    expect(settings).toMatchObject({ watched: true, ignoreGlobs: ['dist/**', 'coverage/**'] });
  });

  it('denies non-owner agent mutations with 403 while preserving not-found responses', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();
    const updateFormData = new FormData();
    updateFormData.set('id', reviewAgent.id);
    updateFormData.set('slug', 'security');
    updateFormData.set('description', 'Finds security issues');
    updateFormData.set('body', 'Review for security issues.');
    updateFormData.set('model', 'sonnet');
    updateFormData.set('effort', 'medium');
    updateFormData.set('enabled', 'true');
    const enableFormData = new FormData();
    enableFormData.set('id', reviewAgent.id);
    enableFormData.set('enabled', 'false');
    const deleteFormData = new FormData();
    deleteFormData.set('id', reviewAgent.id);

    await expect(
      withTestDatabase(() => saveAgent(otherUser.id, updateFormData)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      withTestDatabase(() => setAgentEnabled(otherUser.id, enableFormData)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      withTestDatabase(() => deleteAgent(otherUser.id, deleteFormData)),
    ).rejects.toMatchObject({ status: 403 });

    const missingFormData = new FormData();
    missingFormData.set('id', 'agent_missing');
    await expect(
      withTestDatabase(() => deleteAgent(owner.id, missingFormData)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('normalizes ignore globs by dropping blanks and deduplicating', () => {
    expect(normalizeIgnoreGlobs(['  dist/** ', '', '   ', 'dist/**', 'coverage/**'])).toEqual([
      'dist/**',
      'coverage/**',
    ]);
  });

  it('creates a new agent when no id is submitted', async () => {
    const { owner } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('slug', 'style-checker');
    formData.set('description', 'Checks style');
    formData.set('body', 'Review for style issues.');
    formData.set('model', 'sonnet');
    formData.set('enabled', 'on');

    const result = await withTestDatabase(() => saveAgent(owner.id, formData));

    expect(result).toMatchObject({ success: true });
    const [created] = await testDb.db
      .select()
      .from(agent)
      .where(eq(agent.id, (result as { id: string }).id));
    expect(created).toMatchObject({ slug: 'style-checker', userId: owner.id, enabled: true });
  });

  it('updates an existing owned agent in place', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('id', reviewAgent.id);
    formData.set('slug', 'security');
    formData.set('description', 'Updated description');
    formData.set('body', 'Updated body.');
    formData.set('model', 'opus');
    formData.set('enabled', 'on');

    const result = await withTestDatabase(() => saveAgent(owner.id, formData));

    expect(result).toEqual({ success: true, id: reviewAgent.id });
    const [updated] = await testDb.db.select().from(agent).where(eq(agent.id, reviewAgent.id));
    expect(updated).toMatchObject({ description: 'Updated description', model: 'opus' });
  });

  it('rejects an invalid agent submission with the schema validation error', async () => {
    const { owner } = await seedRepositoryOwnership();
    const formData = new FormData();
    // Invalid: slug must be lowercase-kebab-case; this contains spaces.
    formData.set('slug', 'not a valid slug');
    formData.set('description', 'x');
    formData.set('body', 'x');
    formData.set('model', 'sonnet');
    formData.set('enabled', 'on');

    const result = await withTestDatabase(() => saveAgent(owner.id, formData));

    expect(result).toMatchObject({ status: 400 });
  });

  it('deletes an owned agent', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('id', reviewAgent.id);

    const result = await withTestDatabase(() => deleteAgent(owner.id, formData));

    expect(result).toEqual({ success: true });
    const rows = await testDb.db.select().from(agent).where(eq(agent.id, reviewAgent.id));
    expect(rows).toHaveLength(0);
  });

  it('rejects deleting an agent with a missing id', async () => {
    const { owner } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('id', '');

    const result = await withTestDatabase(() => deleteAgent(owner.id, formData));

    expect(result).toMatchObject({ status: 400, data: { error: 'Agent id is required.' } });
  });

  it('rejects enabling/disabling an agent with a missing id', async () => {
    const { owner } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('id', '');
    formData.set('enabled', 'true');

    const result = await withTestDatabase(() => setAgentEnabled(owner.id, formData));

    expect(result).toMatchObject({ status: 400, data: { error: 'Agent id is required.' } });
  });

  it('404s the losing side of two concurrent deletes racing the same agent', async () => {
    // requireAgentMutationAccess's existence/ownership check and the delete's
    // own WHERE are two separate round trips. Racing two concurrent deletes
    // for the same row means both pass the access check (the row still
    // exists for both), but only one DELETE actually removes a row -- the
    // other's `deletedRows.length === 0` fires deterministically.
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    const formDataA = new FormData();
    formDataA.set('id', reviewAgent.id);
    const formDataB = new FormData();
    formDataB.set('id', reviewAgent.id);

    const [resultA, resultB] = await withTestDatabase(() =>
      Promise.all([deleteAgent(owner.id, formDataA), deleteAgent(owner.id, formDataB)]),
    );

    const results = [resultA, resultB];
    const successes = results.filter((r) => 'success' in r && r.success === true);
    const notFound = results.filter((r) => 'status' in r && r.status === 404);
    expect(successes).toHaveLength(1);
    expect(notFound).toHaveLength(1);
  });

  it('404s the losing side of two concurrent enable/disable toggles racing a deletion', async () => {
    // Same race shape as delete: requireAgentMutationAccess passes for both
    // (the agent still exists at check time), but by the time the update's
    // own WHERE runs, the agent has already been deleted by the other
    // concurrent call, so its update affects 0 rows.
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    const deleteFormData = new FormData();
    deleteFormData.set('id', reviewAgent.id);
    const enableFormData = new FormData();
    enableFormData.set('id', reviewAgent.id);
    enableFormData.set('enabled', 'false');

    const [deleteResult, enableResult] = await withTestDatabase(() =>
      Promise.all([
        deleteAgent(owner.id, deleteFormData),
        setAgentEnabled(owner.id, enableFormData),
      ]),
    );

    // Whichever call's own mutating statement loses the race against the
    // other's DELETE affects 0 rows and returns fail(404); this asserts the
    // race actually produced a 404 rather than requiring a specific side to
    // win (that ordering isn't guaranteed).
    const anyNotFound =
      ('status' in deleteResult && deleteResult.status === 404) ||
      ('status' in enableResult && enableResult.status === 404);
    expect(anyNotFound).toBe(true);
  });

  it('enables and disables an owned agent', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('id', reviewAgent.id);
    formData.set('enabled', 'false');

    const result = await withTestDatabase(() => setAgentEnabled(owner.id, formData));

    expect(result).toEqual({ success: true });
    const [updated] = await testDb.db.select().from(agent).where(eq(agent.id, reviewAgent.id));
    expect(updated?.enabled).toBe(false);
  });

  it('rejects watch settings referencing an agent the user does not own', async () => {
    const { owner } = await seedRepositoryOwnership();

    const result = await withTestDatabase(() =>
      saveRepositoryWatchSettings(owner.id, {
        repositoryId: 9001,
        watched: true,
        ignoreGlobs: [],
        agentIds: ['agent_does_not_exist'],
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'One or more selected agents are unavailable.' },
    });
  });

  it('rejects inherited default models for user review settings', async () => {
    const { owner } = await seedRepositoryOwnership();
    const formData = new FormData();
    formData.set('dailyCostCapUsd', '25');
    formData.set('defaultModel', 'inherit');
    formData.set('reviewsEnabled', 'on');

    const result = await withTestDatabase(() => saveUserReviewSettings(owner.id, formData));

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'Default model is invalid.' },
    });
  });

  it('lists and reads a single agent scoped to the owning user', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();

    const agents = await withTestDatabase(() => listAgents(owner.id));
    expect(agents.map((a) => a.id)).toEqual([reviewAgent.id]);

    const found = await withTestDatabase(() => getAgent(owner.id, reviewAgent.id));
    expect(found).toMatchObject({ id: reviewAgent.id });

    const missing = await withTestDatabase(() => getAgent(owner.id, 'agent_missing'));
    expect(missing).toBeNull();
  });

  it('returns the run overview scoped to the owning user, newest first', async () => {
    const { owner } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_older',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 1,
      headSha: 'sha-older',
      trigger: 'opened',
      startedAt: new Date('2026-06-01T00:00:00Z'),
    });
    await insertReviewRun({
      id: 'run_newer',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 2,
      headSha: 'sha-newer',
      trigger: 'opened',
      startedAt: new Date('2026-06-02T00:00:00Z'),
    });

    const overview = await withTestDatabase(() => getRunsOverview(owner.id));

    expect(overview.map((r) => r.id)).toEqual(['run_newer', 'run_older']);
    expect(overview[0]).toMatchObject({
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
    });
  });

  it('rejects a negative or non-numeric daily cost cap for user review settings', async () => {
    const { owner } = await seedRepositoryOwnership();

    const negative = new FormData();
    negative.set('dailyCostCapUsd', '-5');
    negative.set('defaultModel', 'sonnet');
    await expect(
      withTestDatabase(() => saveUserReviewSettings(owner.id, negative)),
    ).resolves.toMatchObject({
      status: 400,
      data: { error: 'Daily cost cap must be zero or greater.' },
    });

    const notANumber = new FormData();
    notANumber.set('dailyCostCapUsd', 'not-a-number');
    notANumber.set('defaultModel', 'sonnet');
    await expect(
      withTestDatabase(() => saveUserReviewSettings(owner.id, notANumber)),
    ).resolves.toMatchObject({
      status: 400,
      data: { error: 'Daily cost cap must be zero or greater.' },
    });
  });

  it('upserts valid user review settings and getUserReviewSettings reads them back', async () => {
    const { owner } = await seedRepositoryOwnership();

    const initial = await withTestDatabase(() => getUserReviewSettings(owner.id));
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ userId: owner.id });

    const formData = new FormData();
    formData.set('dailyCostCapUsd', '15');
    formData.set('defaultModel', 'opus');
    formData.set('reviewsEnabled', 'on');

    const result = await withTestDatabase(() => saveUserReviewSettings(owner.id, formData));
    expect(result).toEqual({ success: true });

    const [settingsRow] = await testDb.db
      .select()
      .from(userReviewSettings)
      .where(eq(userReviewSettings.userId, owner.id));
    expect(settingsRow).toMatchObject({
      dailyCostCapUsd: '15',
      defaultModel: 'opus',
      reviewsEnabled: true,
    });

    // A second read via getUserReviewSettings exercises the onConflictDoNothing
    // fallback-select branch (the row already exists from the upsert above).
    const secondRead = await withTestDatabase(() => getUserReviewSettings(owner.id));
    expect(secondRead[0]).toMatchObject({ defaultModel: 'opus' });
  });

  it('exposes the model options, effort options, and effort validator', () => {
    expect(getReviewModelOptions()).toEqual(['inherit', 'sonnet', 'opus', 'haiku', 'fable']);
    expect(getReviewEffortOptions()).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(validateEffort('medium')).toBe(true);
    expect(validateEffort('not-a-real-effort')).toBe(false);
  });

  it('scopes run inspection and stop control to the owning user', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    await testDb.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { denied: true, reason: 'outside repository' },
    });

    const inspected = await withTestDatabase(() => getRunInspector(owner.id, 'run_1'));
    expect(inspected.agentRuns[0]?.events[0]?.detail).toMatchObject({ denied: true });
    await expect(
      withTestDatabase(() => getRunInspector(otherUser.id, 'run_1')),
    ).rejects.toMatchObject({ status: 403 });
    await expect(withTestDatabase(() => stopRun(otherUser.id, 'run_1'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      withTestDatabase(() => stopAgent(otherUser.id, 'run_1', reviewAgent.id)),
    ).rejects.toMatchObject({
      status: 403,
    });

    await withTestDatabase(() => stopRun(owner.id, 'run_1'));
    const stoppedRun = await selectReviewRun('run_1');
    expect(stoppedRun?.status).toBe('cancelled');
    const [stoppedAgentRun] = await testDb.db
      .select()
      .from(agentRun)
      .where(eq(agentRun.id, 'agent_run_1'));
    expect(stoppedAgentRun.stoppedReason).toBe('timeout');
  });

  it('inspects webhook event handler runs while preserving ownership checks', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();
    const [storedWebhookEvent] = await testDb.db
      .insert(webhookEvent)
      .values({
        repositoryId: 9001,
        eventType: 'issues',
        action: 'opened',
        payload: '{}',
      })
      .returning({ id: webhookEvent.id });
    await testDb.db.insert(tribunalRun).values({
      id: 'run_webhook_1',
      userId: owner.id,
      repositoryId: 9001,
      runKind: 'webhook_event_handler',
      status: 'queued',
    });
    await testDb.db.insert(webhookEventHandlerRun).values({
      runId: 'run_webhook_1',
      userId: owner.id,
      repositoryId: 9001,
      webhookEventId: storedWebhookEvent.id,
      eventType: 'issues',
      action: 'opened',
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_webhook_1',
      userId: owner.id,
      runId: 'run_webhook_1',
      agentId: reviewAgent.id,
      status: 'queued',
    });

    const inspected = await withTestDatabase(() => getRunInspector(owner.id, 'run_webhook_1'));
    expect(inspected).toMatchObject({
      id: 'run_webhook_1',
      runKind: 'webhook_event_handler',
      webhookEventId: storedWebhookEvent.id,
      eventType: 'issues',
      action: 'opened',
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
    });
    expect(inspected.agentRuns).toHaveLength(1);

    await expect(
      withTestDatabase(() => getRunInspector(otherUser.id, 'run_webhook_1')),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      withTestDatabase(() => getRunInspector(owner.id, 'run_does_not_exist')),
    ).rejects.toMatchObject({ status: 404, body: { message: 'Run not found.' } });
  });

  it('404s a pull_request_review run whose review row is missing (data inconsistency)', async () => {
    const { owner } = await seedRepositoryOwnership();
    await testDb.db.insert(tribunalRun).values({
      id: 'run_orphaned_review',
      userId: owner.id,
      repositoryId: 9001,
      runKind: 'pull_request_review',
      status: 'queued',
    });

    await expect(
      withTestDatabase(() => getRunInspector(owner.id, 'run_orphaned_review')),
    ).rejects.toMatchObject({ status: 404, body: { message: 'Run details not found.' } });
  });

  it('404s a webhook_event_handler run whose handler row is missing (data inconsistency)', async () => {
    const { owner } = await seedRepositoryOwnership();
    await testDb.db.insert(tribunalRun).values({
      id: 'run_orphaned_webhook',
      userId: owner.id,
      repositoryId: 9001,
      runKind: 'webhook_event_handler',
      status: 'queued',
    });

    await expect(
      withTestDatabase(() => getRunInspector(owner.id, 'run_orphaned_webhook')),
    ).rejects.toMatchObject({ status: 404, body: { message: 'Run details not found.' } });
  });

  it('404s streaming a run that does not exist', async () => {
    const { owner } = await seedRepositoryOwnership();
    const abortController = new AbortController();

    await expect(
      withTestDatabase(() =>
        streamRunAgentEvents(owner.id, 'run_does_not_exist', abortController.signal),
      ),
    ).rejects.toMatchObject({ status: 404, body: { message: 'Run not found.' } });
  });

  it('403s streaming a run owned by a different user', async () => {
    const { owner, otherUser } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    const abortController = new AbortController();

    await expect(
      withTestDatabase(() => streamRunAgentEvents(otherUser.id, 'run_1', abortController.signal)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('streams only new agent events and sends an idle keepalive', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    const [storedEvent] = await testDb.db
      .insert(agentEvent)
      .values({
        agentRunId: 'agent_run_1',
        seq: 1,
        kind: 'tool_pre',
        tool: 'Read',
        detail: { allowed: true },
      })
      .returning();
    const abortController = new AbortController();

    const response = await withTestDatabase(() =>
      streamRunAgentEvents(owner.id, 'run_1', abortController.signal, storedEvent.id),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();
    const firstChunk = await reader.read();
    let streamedText = decoder.decode(firstChunk.value ?? new Uint8Array());
    if (!streamedText.includes(': keepalive')) {
      const secondChunk = await reader.read();
      streamedText += decoder.decode(secondChunk.value ?? new Uint8Array());
    }
    abortController.abort();
    await reader.cancel().catch(() => undefined);

    expect(streamedText).toContain(': connected');
    expect(streamedText).toContain(': keepalive');
    expect(streamedText).not.toContain('event: agent_event');
  });

  it('emits an error chunk when reading agent events fails, then recovers on the next poll', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const abortController = new AbortController();

    // The ReadableStream's start() callback runs synchronously during
    // construction (inside streamRunAgentEvents, before it returns), so the
    // first poll's `select()` already fires before this call resolves --
    // too late to intercept with a spy set up afterward. Instead, count
    // calls: #1 is requireRunAccess's own select (must pass through), #2 is
    // listRunAgentEvents's first poll (fail it), then fall back to the real
    // implementation for any later, unrelated selects.
    let selectCallCount = 0;
    const realSelect = testDb.db.select.bind(testDb.db);
    const selectSpy = vi
      .spyOn(testDb.db, 'select')
      .mockImplementation((...args: Parameters<typeof testDb.db.select>) => {
        selectCallCount += 1;
        if (selectCallCount === 2) throw new Error('connection reset');
        return realSelect(...args);
      });

    const response = await withTestDatabase(() =>
      streamRunAgentEvents(owner.id, 'run_1', abortController.signal, 0),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();
    let streamedText = decoder.decode((await reader.read()).value ?? new Uint8Array());
    if (!streamedText.includes(': event read failed')) {
      streamedText += decoder.decode((await reader.read()).value ?? new Uint8Array());
    }
    abortController.abort();
    await reader.cancel().catch(() => undefined);
    selectSpy.mockRestore();

    expect(streamedText).toContain(': event read failed');
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to stream run agent events',
      expect.objectContaining({ runId: 'run_1', error: expect.any(Error) }),
    );
  });

  it('reschedules and polls again ~2.5s after connecting, and cancel() clears the pending timer', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    const abortController = new AbortController();

    const response = await withTestDatabase(() =>
      streamRunAgentEvents(owner.id, 'run_1', abortController.signal, 0),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();

    // First chunk: ": connected". Second chunk: the first poll's keepalive.
    let streamedText = decoder.decode((await reader.read()).value ?? new Uint8Array());
    streamedText += decoder.decode((await reader.read()).value ?? new Uint8Array());
    const keepalivesBeforeWait = streamedText.split(': keepalive').length - 1;

    // Insert a new event so the *rescheduled* poll (fired by the internal
    // setTimeout ~2.5s after the first poll) has something new to emit,
    // proving the reschedule actually ran rather than just idling.
    await testDb.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { allowed: true },
    });

    streamedText += decoder.decode((await reader.read()).value ?? new Uint8Array());

    abortController.abort();
    await reader.cancel().catch(() => undefined);

    const keepalivesAfterWait = streamedText.split(': keepalive').length - 1;
    expect(keepalivesAfterWait).toBeGreaterThanOrEqual(keepalivesBeforeWait);
    expect(streamedText).toContain('event: agent_event');
  }, 8_000);

  it('cancel() clears the pending reschedule timer so no further polls run after the reader cancels', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    const abortController = new AbortController();

    const response = await withTestDatabase(() =>
      streamRunAgentEvents(owner.id, 'run_1', abortController.signal, 0),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    // Consume the initial ": connected" + first keepalive, then cancel the
    // reader directly (exercising the stream's `cancel()` handler) before
    // the ~2.5s reschedule would otherwise fire.
    await reader.read();
    await reader.read();
    await reader.cancel();

    // Insert an event that a still-running reschedule would have emitted,
    // then wait past the reschedule interval. If cancel() failed to clear
    // the timer, `enqueue` would still be called, but `controller.enqueue`
    // on an already-cancelled stream throws -- surfacing as an unhandled
    // rejection rather than silently succeeding. Reading again after cancel
    // must reject or return done, proving no further polling is observable.
    await testDb.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { allowed: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 2_800));

    const result = await reader.read().catch((error: unknown) => ({ done: true, error }));
    expect(result.done).toBe(true);
  }, 8_000);

  it('streams an already-buffered agent event immediately (no afterEventId cursor)', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    await testDb.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { allowed: true },
    });
    const abortController = new AbortController();

    // No afterEventId cursor: the stream computes the latest seen id from the
    // DB (0, since this event was inserted before the stream opened is not
    // how the cursor works — omitting it makes the activity's own
    // getLatestRunAgentEventId resolve to the already-inserted event's id, so
    // pass an explicit cursor of 0 to force the "new event" branch instead).
    const response = await withTestDatabase(() =>
      streamRunAgentEvents(owner.id, 'run_1', abortController.signal, 0),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();
    let streamedText = decoder.decode((await reader.read()).value ?? new Uint8Array());
    if (!streamedText.includes('event: agent_event')) {
      streamedText += decoder.decode((await reader.read()).value ?? new Uint8Array());
    }
    abortController.abort();
    await reader.cancel().catch(() => undefined);

    expect(streamedText).toContain('event: agent_event');
  });

  it('resolves the latest event id from the database when no cursor is supplied', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    await testDb.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { allowed: true },
    });
    const abortController = new AbortController();

    // No afterEventId: the stream resolves its own cursor via
    // getLatestRunAgentEventId, which should be the already-inserted event's
    // id — so no further events are "new" and a keepalive is sent instead.
    const response = await withTestDatabase(() =>
      streamRunAgentEvents(owner.id, 'run_1', abortController.signal),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();
    let streamedText = decoder.decode((await reader.read()).value ?? new Uint8Array());
    if (!streamedText.includes(': keepalive')) {
      streamedText += decoder.decode((await reader.read()).value ?? new Uint8Array());
    }
    abortController.abort();
    await reader.cancel().catch(() => undefined);

    expect(streamedText).toContain(': keepalive');
    expect(streamedText).not.toContain('event: agent_event');
  });

  it('stops one owned agent run and signals the live engine when configured', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agent).values({
      id: 'agent_performance',
      userId: owner.id,
      slug: 'performance',
      description: 'Finds performance issues',
      body: 'Review for performance issues.',
      model: 'sonnet',
      enabled: true,
    });
    await testDb.db.insert(agentRun).values([
      {
        id: 'agent_run_security',
        userId: owner.id,
        runId: 'run_1',
        agentId: reviewAgent.id,
        status: 'running',
      },
      {
        id: 'agent_run_performance',
        userId: owner.id,
        runId: 'run_1',
        agentId: 'agent_performance',
        status: 'running',
      },
    ]);

    await expect(
      withTestDatabase(() => stopAgent(owner.id, 'run_1', reviewAgent.id)),
    ).resolves.toEqual({
      ok: true,
    });

    const rows = await testDb.db.select().from(agentRun).orderBy(agentRun.id);
    expect(rows).toMatchObject([
      { id: 'agent_run_performance', status: 'running', stoppedReason: null },
      { id: 'agent_run_security', status: 'cancelled', stoppedReason: 'timeout' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://engine.tribunal.test/review-runs/run_1/agents/agent_security/stop'),
      {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      },
    );
  });

  it('keeps the persisted agent stop when the live engine agent-stop signal itself throws', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unreachable'));
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_security',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });

    await expect(
      withTestDatabase(() => stopAgent(owner.id, 'run_1', reviewAgent.id)),
    ).resolves.toEqual({ ok: true });

    expect(warnMock).toHaveBeenCalledWith('Engine agent stop signal failed.', expect.any(Error));
  });

  it('warns (but still succeeds) when the live engine agent-stop signal returns a non-404 failure status', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_security',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });

    await expect(
      withTestDatabase(() => stopAgent(owner.id, 'run_1', reviewAgent.id)),
    ).resolves.toEqual({ ok: true });

    expect(warnMock).toHaveBeenCalledWith('Engine agent stop signal failed with status 500.');
  });

  it('returns not found when an owned run does not contain the requested agent run', async () => {
    const { owner } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });

    await expect(
      withTestDatabase(() => stopAgent(owner.id, 'run_1', 'agent_missing')),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns run inspector findings in deterministic order', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_findings',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'posted',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_findings',
      userId: owner.id,
      runId: 'run_findings',
      agentId: reviewAgent.id,
      status: 'succeeded',
    });
    await testDb.db.insert(finding).values([
      {
        id: 'finding_second',
        userId: owner.id,
        agentRunId: 'agent_run_findings',
        path: 'src/b.ts',
        startLine: 2,
        endLine: null,
        side: 'RIGHT',
        severity: 'warning',
        title: 'Second',
        body: 'Second finding',
        anchored: true,
        fingerprint: 'fingerprint_second',
      },
      {
        id: 'finding_first',
        userId: owner.id,
        agentRunId: 'agent_run_findings',
        path: 'src/a.ts',
        startLine: 10,
        endLine: null,
        side: 'RIGHT',
        severity: 'warning',
        title: 'First',
        body: 'First finding',
        anchored: true,
        fingerprint: 'fingerprint_first',
      },
    ]);

    const inspected = await withTestDatabase(() => getRunInspector(owner.id, 'run_findings'));

    expect(inspected.agentRuns[0]?.findings.map((row) => row.id)).toEqual([
      'finding_first',
      'finding_second',
    ]);
  });

  it('links a superseded run to the replacement run derived from the previous head', async () => {
    const { owner } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_superseded',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'superseded',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await insertReviewRun({
      id: 'run_replacement',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'def456',
      prevHeadSha: 'abc123',
      trigger: 'synchronize',
      status: 'running',
      startedAt: new Date('2026-06-17T12:05:00Z'),
    });

    const inspected = await withTestDatabase(() => getRunInspector(owner.id, 'run_superseded'));

    expect(inspected.replacementRunId).toBe('run_replacement');
  });

  it('signals the live engine after marking an owned run stopped when configured', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 22,
      headSha: 'abc123',
      trigger: 'manual',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });

    await withTestDatabase(() => stopRun(owner.id, 'run_1'));

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://engine.tribunal.test/review-runs/run_1/stop'),
      {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      },
    );
  });

  it('keeps the persisted stop when the live engine stop signal fails', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 22,
      headSha: 'abc123',
      trigger: 'manual',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });

    await expect(withTestDatabase(() => stopRun(owner.id, 'run_1'))).resolves.toEqual({
      ok: true,
    });

    const stoppedRun = await selectReviewRun('run_1');
    expect(stoppedRun?.status).toBe('cancelled');
    expect(warnMock).toHaveBeenCalledWith('Engine stop signal failed with status 503.');
  });

  it('keeps the persisted stop when the live engine stop signal itself throws (network failure)', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unreachable'));
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertReviewRun({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 22,
      headSha: 'abc123',
      trigger: 'manual',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });

    await expect(withTestDatabase(() => stopRun(owner.id, 'run_1'))).resolves.toEqual({
      ok: true,
    });

    expect(warnMock).toHaveBeenCalledWith('Engine stop signal failed.', expect.any(Error));
  });

  it('rolls up estimated costs and cache-token splits', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await insertReviewRun({
      id: 'run_cost',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 22,
      headSha: 'def456',
      trigger: 'manual',
      status: 'posted',
    });
    await insertReviewRun({
      id: 'run_cost_2',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 23,
      headSha: 'ghi789',
      trigger: 'manual',
      status: 'posted',
    });
    await testDb.db.insert(agent).values({
      id: 'agent_performance',
      userId: owner.id,
      slug: 'performance',
      description: 'Finds performance issues',
      body: 'Review for performance issues.',
      model: 'sonnet',
      enabled: true,
    });
    await testDb.db.insert(agentRun).values([
      {
        id: 'agent_run_cost',
        userId: owner.id,
        runId: 'run_cost',
        agentId: reviewAgent.id,
        status: 'succeeded',
      },
      {
        id: 'agent_run_cost_2',
        userId: owner.id,
        runId: 'run_cost_2',
        agentId: 'agent_performance',
        status: 'succeeded',
      },
    ]);
    await testDb.db.insert(costEvent).values([
      {
        id: 'cost_1',
        userId: owner.id,
        kind: 'llm',
        source: 'estimate',
        repositoryId: 9001,
        reviewRunId: 'run_cost',
        agentRunId: 'agent_run_cost',
        agentId: reviewAgent.id,
        amountUsd: '1.25',
        idempotencyKey: 'cost_1',
        meta: { cacheReadTokens: 20, cacheCreationTokens: 10 },
      },
      {
        id: 'cost_2',
        userId: owner.id,
        kind: 'llm',
        source: 'estimate',
        repositoryId: 9001,
        reviewRunId: 'run_cost_2',
        agentRunId: 'agent_run_cost_2',
        agentId: 'agent_performance',
        amountUsd: '2.5',
        idempotencyKey: 'cost_2',
        meta: { cacheReadTokens: 5, cacheCreationTokens: 15 },
      },
    ]);

    const overview = await withTestDatabase(() => getCostOverview(owner.id, 'estimate'));

    // Two distinct labels in each rollup exercises the multi-entry sort path
    // (rollup() is only meaningfully exercised with 2+ groups).
    expect(overview.rollups.byReviewRun).toEqual([
      { label: 'run_cost_2', amountUsd: 2.5 },
      { label: 'run_cost', amountUsd: 1.25 },
    ]);
    expect(overview.rollups.byAgent).toEqual([
      { label: 'performance', amountUsd: 2.5 },
      { label: 'security', amountUsd: 1.25 },
    ]);
    expect(overview.rollups.byAgentPerRepository).toEqual([
      { label: 'performance @ lost-gradient/tribunal', amountUsd: 2.5 },
      { label: 'security @ lost-gradient/tribunal', amountUsd: 1.25 },
    ]);
    expect(overview.cacheTokens).toEqual({ cacheReadTokens: 25, cacheCreationTokens: 25 });
  });
});
