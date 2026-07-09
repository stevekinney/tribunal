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
  repository,
  repositoryAgent,
  repositoryReviewSettings,
  reviewRun,
  user,
  userReviewSettings,
} from '@tribunal/database/schema';
import { eq } from 'drizzle-orm';
import {
  deleteAgent,
  getRepositoryOperatorDetails,
  getCostOverview,
  getReviewsEnabled,
  getRunInspector,
  hasWatchedRepositories,
  saveAgent,
  saveRepositoryWatchSettings,
  saveUserReviewSettings,
  setAgentEnabled,
  stopAgent,
  stopRun,
  streamRunAgentEvents,
  submitRepositorySettingsForm,
  userOwnsRepository,
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
    });
    expect(secondDetails.get(9101)).toMatchObject({
      watched: false,
      ignoreGlobs: ['src/generated/**'],
      agents: [{ id: secondAgent.id, slug: secondAgent.slug, enabled: true }],
    });
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

  it('scopes run inspection and stop control to the owning user', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();
    await testDb.db.insert(reviewRun).values({
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
      reviewRunId: 'run_1',
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
    const [stoppedRun] = await testDb.db.select().from(reviewRun).where(eq(reviewRun.id, 'run_1'));
    expect(stoppedRun.status).toBe('cancelled');
    const [stoppedAgentRun] = await testDb.db
      .select()
      .from(agentRun)
      .where(eq(agentRun.id, 'agent_run_1'));
    expect(stoppedAgentRun.stoppedReason).toBe('timeout');
  });

  it('streams only new agent events and sends an idle keepalive', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await testDb.db.insert(reviewRun).values({
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
      reviewRunId: 'run_1',
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

  it('stops one owned agent run and signals the live engine when configured', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await testDb.db.insert(reviewRun).values({
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
        reviewRunId: 'run_1',
        agentId: reviewAgent.id,
        status: 'running',
      },
      {
        id: 'agent_run_performance',
        userId: owner.id,
        reviewRunId: 'run_1',
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

  it('returns not found when an owned run does not contain the requested agent run', async () => {
    const { owner } = await seedRepositoryOwnership();
    await testDb.db.insert(reviewRun).values({
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
    await testDb.db.insert(reviewRun).values({
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
      reviewRunId: 'run_findings',
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
    await testDb.db.insert(reviewRun).values([
      {
        id: 'run_superseded',
        userId: owner.id,
        repositoryId: 9001,
        prNumber: 12,
        headSha: 'abc123',
        trigger: 'opened',
        status: 'superseded',
        startedAt: new Date('2026-06-17T12:00:00Z'),
      },
      {
        id: 'run_replacement',
        userId: owner.id,
        repositoryId: 9001,
        prNumber: 12,
        headSha: 'def456',
        prevHeadSha: 'abc123',
        trigger: 'synchronize',
        status: 'running',
        startedAt: new Date('2026-06-17T12:05:00Z'),
      },
    ]);

    const inspected = await withTestDatabase(() => getRunInspector(owner.id, 'run_superseded'));

    expect(inspected.replacementRunId).toBe('run_replacement');
  });

  it('signals the live engine after marking an owned run stopped when configured', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    mocks.env.TRIBUNAL_ENGINE_URL = 'https://engine.tribunal.test';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await testDb.db.insert(reviewRun).values({
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
      reviewRunId: 'run_1',
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
    await testDb.db.insert(reviewRun).values({
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
      reviewRunId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });

    await expect(withTestDatabase(() => stopRun(owner.id, 'run_1'))).resolves.toEqual({
      ok: true,
    });

    const [stoppedRun] = await testDb.db.select().from(reviewRun).where(eq(reviewRun.id, 'run_1'));
    expect(stoppedRun.status).toBe('cancelled');
    expect(warnMock).toHaveBeenCalledWith('Engine stop signal failed with status 503.');
  });

  it('rolls up estimated costs and cache-token splits', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await testDb.db.insert(reviewRun).values({
      id: 'run_cost',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 22,
      headSha: 'def456',
      trigger: 'manual',
      status: 'posted',
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_cost',
      userId: owner.id,
      reviewRunId: 'run_cost',
      agentId: reviewAgent.id,
      status: 'succeeded',
    });
    await testDb.db.insert(costEvent).values({
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
    });

    const overview = await withTestDatabase(() => getCostOverview(owner.id, 'estimate'));

    expect(overview.rollups.byReviewRun).toEqual([{ label: 'run_cost', amountUsd: 1.25 }]);
    expect(overview.rollups.byAgent).toEqual([{ label: 'security', amountUsd: 1.25 }]);
    expect(overview.rollups.byAgentPerRepository).toEqual([
      { label: 'security @ lost-gradient/tribunal', amountUsd: 1.25 },
    ]);
    expect(overview.cacheTokens).toEqual({ cacheReadTokens: 20, cacheCreationTokens: 10 });
  });
});
