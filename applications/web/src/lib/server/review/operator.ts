import { error, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
  userReviewSettings,
} from '@tribunal/database/schema';
import { agentSpecSchema, effortSchema, agentModelSchema } from '@tribunal/review-core/schemas';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/database';
export { getEffortFallbackNotice } from '$lib/review/operator-ui';

const reviewModelOptions = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'] as const;
const reviewEffortOptions = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type SurfaceState = 'empty' | 'loading' | 'streaming' | 'success' | 'error' | 'disconnected';

export const operatorSurfaceStates: SurfaceState[] = [
  'empty',
  'loading',
  'streaming',
  'success',
  'error',
  'disconnected',
];

export function parseIgnoreGlobs(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((glob) => glob.trim())
    .filter((glob) => glob.length > 0);
}

async function userOwnsRepository(userId: number, repositoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ repositoryId: githubInstallationRepository.repositoryId })
    .from(githubInstallationRepository)
    .innerJoin(
      githubInstallation,
      eq(githubInstallation.installationId, githubInstallationRepository.installationId),
    )
    .where(
      and(
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.status, 'active'),
        eq(githubInstallationRepository.isActive, true),
        eq(githubInstallationRepository.repositoryId, repositoryId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function requireRepositoryOwnership(userId: number, repositoryId: number) {
  if (!(await userOwnsRepository(userId, repositoryId))) {
    error(403, 'You do not have access to this repository.');
  }
}

async function requireAgentMutationAccess(userId: number, agentId: string) {
  const [row] = await db
    .select({ userId: agent.userId })
    .from(agent)
    .where(eq(agent.id, agentId))
    .limit(1);

  if (!row) error(404, 'Agent not found.');
  if (row.userId !== userId) error(403, 'You do not have access to this agent.');
}

export async function getRepositoryOperatorDetails(userId: number, repositoryIds: number[]) {
  if (repositoryIds.length === 0) return new Map<number, RepositoryOperatorDetails>();

  const [settingsRows, assignmentRows, runRows, costRows] = await Promise.all([
    db
      .select()
      .from(repositoryReviewSettings)
      .where(
        and(
          eq(repositoryReviewSettings.userId, userId),
          inArray(repositoryReviewSettings.repositoryId, repositoryIds),
        ),
      ),
    db
      .select({
        repositoryId: repositoryAgent.repositoryId,
        agentId: agent.id,
        slug: agent.slug,
        enabled: agent.enabled,
      })
      .from(repositoryAgent)
      .innerJoin(agent, eq(agent.id, repositoryAgent.agentId))
      .where(
        and(
          eq(repositoryAgent.userId, userId),
          eq(agent.userId, userId),
          inArray(repositoryAgent.repositoryId, repositoryIds),
        ),
      ),
    db
      .select()
      .from(reviewRun)
      .where(and(eq(reviewRun.userId, userId), inArray(reviewRun.repositoryId, repositoryIds)))
      .orderBy(desc(reviewRun.startedAt)),
    db
      .select()
      .from(costEvent)
      .where(
        and(
          eq(costEvent.userId, userId),
          inArray(costEvent.repositoryId, repositoryIds),
          sql`${costEvent.occurredAt} >= now() - interval '30 days'`,
        ),
      ),
  ]);

  const details = new Map<number, RepositoryOperatorDetails>();
  for (const repositoryId of repositoryIds) {
    details.set(repositoryId, {
      watched: false,
      ignoreGlobs: [],
      agents: [],
      lastRunStatus: null,
      estimatedCostLast30DaysUsd: 0,
    });
  }

  for (const settings of settingsRows) {
    const detail = details.get(settings.repositoryId);
    if (!detail) continue;
    detail.watched = settings.watched;
    detail.ignoreGlobs = settings.ignoreGlobs;
  }

  for (const assignment of assignmentRows) {
    details.get(assignment.repositoryId)?.agents.push({
      id: assignment.agentId,
      slug: assignment.slug,
      enabled: assignment.enabled,
    });
  }

  const seenRuns = new Set<number>();
  for (const run of runRows) {
    if (seenRuns.has(run.repositoryId)) continue;
    seenRuns.add(run.repositoryId);
    const detail = details.get(run.repositoryId);
    if (detail) detail.lastRunStatus = run.status;
  }

  for (const event of costRows) {
    if (event.source !== 'estimate' || event.repositoryId === null) continue;
    const detail = details.get(event.repositoryId);
    if (detail) detail.estimatedCostLast30DaysUsd += Number(event.amountUsd);
  }

  return details;
}

export type RepositoryOperatorDetails = {
  watched: boolean;
  ignoreGlobs: string[];
  agents: { id: string; slug: string; enabled: boolean }[];
  lastRunStatus: string | null;
  estimatedCostLast30DaysUsd: number;
};

export async function saveRepositoryWatchSettings(
  userId: number,
  input: {
    repositoryId: number;
    watched: boolean;
    ignoreGlobs: string[];
    agentIds: string[];
  },
) {
  await requireRepositoryOwnership(userId, input.repositoryId);

  const allowedAgents = await db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.userId, userId), inArray(agent.id, input.agentIds)));

  if (allowedAgents.length !== input.agentIds.length) {
    return fail(400, { error: 'One or more selected agents are unavailable.' });
  }

  const agentIdSql =
    input.agentIds.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(
          input.agentIds.map((agentId) => sql`${agentId}`),
          sql`, `,
        )}]::text[]`;
  const ignoreGlobsSql =
    input.ignoreGlobs.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(
          input.ignoreGlobs.map((glob) => sql`${glob}`),
          sql`, `,
        )}]::text[]`;
  const now = new Date();

  await db.execute(sql`
    WITH updated_settings AS (
      INSERT INTO ${repositoryReviewSettings}
        ("user_id", "repository_id", "watched", "ignore_globs", "updated_at")
      VALUES (${userId}, ${input.repositoryId}, ${input.watched}, ${ignoreGlobsSql}, ${now})
      ON CONFLICT ("user_id", "repository_id") DO UPDATE SET
        "watched" = excluded."watched",
        "ignore_globs" = excluded."ignore_globs",
        "updated_at" = excluded."updated_at"
      RETURNING "user_id", "repository_id"
    ),
    selected_agents AS (
      SELECT unnest(${agentIdSql}) AS agent_id
    ),
    removed_agents AS (
      DELETE FROM ${repositoryAgent}
      WHERE ${repositoryAgent.userId} = ${userId}
        AND ${repositoryAgent.repositoryId} = ${input.repositoryId}
        AND NOT EXISTS (
          SELECT 1 FROM selected_agents
          WHERE selected_agents.agent_id = ${repositoryAgent.agentId}
        )
      RETURNING ${repositoryAgent.agentId}
    )
    INSERT INTO "repository_agent" ("user_id", "repository_id", "agent_id")
    SELECT updated_settings."user_id", updated_settings."repository_id", selected_agents.agent_id
    FROM updated_settings, selected_agents
    ON CONFLICT DO NOTHING
  `);

  return { success: true };
}

export async function listAgents(userId: number) {
  return db.select().from(agent).where(eq(agent.userId, userId)).orderBy(agent.slug);
}

export async function saveAgent(userId: number, formData: FormData) {
  const id = String(formData.get('id') ?? '').trim();
  const effortValue = String(formData.get('effort') ?? '').trim();
  const payload = {
    id: id || `agent_${crypto.randomUUID()}`,
    userId,
    slug: String(formData.get('slug') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    body: String(formData.get('body') ?? '').trim(),
    model: String(formData.get('model') ?? 'inherit').trim(),
    effort: effortValue === '' ? undefined : effortValue,
    enabled: formData.get('enabled') === 'on',
  };

  const validation = agentSpecSchema.safeParse(payload);
  if (!validation.success) {
    return fail(400, {
      error: validation.error.issues[0]?.message ?? 'Agent settings are invalid.',
      values: payload,
    });
  }

  if (id) {
    await requireAgentMutationAccess(userId, id);
  }

  await db
    .insert(agent)
    .values(validation.data)
    .onConflictDoUpdate({
      target: agent.id,
      set: {
        slug: validation.data.slug,
        description: validation.data.description,
        body: validation.data.body,
        model: validation.data.model,
        effort: validation.data.effort ?? null,
        enabled: validation.data.enabled,
        updatedAt: new Date(),
      },
    });

  return { success: true };
}

export async function deleteAgent(userId: number, formData: FormData) {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return fail(400, { error: 'Agent id is required.' });
  await requireAgentMutationAccess(userId, id);

  const deletedRows = await db
    .delete(agent)
    .where(and(eq(agent.id, id), eq(agent.userId, userId)))
    .returning({ id: agent.id });

  if (deletedRows.length === 0) {
    return fail(404, { error: 'Agent not found.' });
  }

  return { success: true };
}

export async function setAgentEnabled(userId: number, formData: FormData) {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return fail(400, { error: 'Agent id is required.' });
  await requireAgentMutationAccess(userId, id);

  const enabled = formData.get('enabled') === 'true';
  const updatedRows = await db
    .update(agent)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(agent.id, id), eq(agent.userId, userId)))
    .returning({ id: agent.id });

  if (updatedRows.length === 0) {
    return fail(404, { error: 'Agent not found.' });
  }

  return { success: true };
}

export async function getRunsOverview(userId: number) {
  const rows = await db
    .select({
      run: reviewRun,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
    })
    .from(reviewRun)
    .innerJoin(repository, eq(repository.id, reviewRun.repositoryId))
    .where(eq(reviewRun.userId, userId))
    .orderBy(desc(reviewRun.startedAt))
    .limit(50);

  return rows.map((row) => ({
    ...row.run,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
  }));
}

export async function getRunInspector(userId: number, runId: string) {
  const [runRow] = await db
    .select({
      run: reviewRun,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
    })
    .from(reviewRun)
    .innerJoin(repository, eq(repository.id, reviewRun.repositoryId))
    .where(eq(reviewRun.id, runId))
    .limit(1);

  if (!runRow) error(404, 'Run not found.');
  if (runRow.run.userId !== userId) error(403, 'You do not have access to this run.');

  const [agentRows, findingRows] = await Promise.all([
    db
      .select({
        agentRun,
        slug: agent.slug,
        description: agent.description,
      })
      .from(agentRun)
      .innerJoin(agent, eq(agent.id, agentRun.agentId))
      .where(and(eq(agentRun.userId, userId), eq(agentRun.reviewRunId, runId)))
      .orderBy(agent.slug),
    db
      .select({ finding })
      .from(finding)
      .innerJoin(agentRun, eq(agentRun.id, finding.agentRunId))
      .where(and(eq(finding.userId, userId), eq(agentRun.reviewRunId, runId)))
      .orderBy(
        finding.agentRunId,
        finding.path,
        asc(finding.startLine),
        asc(finding.endLine),
        finding.fingerprint,
        finding.id,
      ),
  ]);

  const agentRunIds = agentRows.map((row) => row.agentRun.id);
  const eventRows =
    agentRunIds.length === 0
      ? []
      : await db
          .select()
          .from(agentEvent)
          .where(inArray(agentEvent.agentRunId, agentRunIds))
          .orderBy(agentEvent.agentRunId, agentEvent.seq);

  const replacementRun = await getReplacementRun(userId, runRow.run);

  const findingsByAgentRun = new Map<string, typeof findingRows>();
  for (const row of findingRows) {
    const rows = findingsByAgentRun.get(row.finding.agentRunId) ?? [];
    rows.push(row);
    findingsByAgentRun.set(row.finding.agentRunId, rows);
  }

  const eventsByAgentRun = new Map<string, typeof eventRows>();
  for (const event of eventRows) {
    const rows = eventsByAgentRun.get(event.agentRunId) ?? [];
    rows.push(event);
    eventsByAgentRun.set(event.agentRunId, rows);
  }

  return {
    ...runRow.run,
    repositoryOwner: runRow.repositoryOwner,
    repositoryName: runRow.repositoryName,
    replacementRunId: replacementRun?.id ?? null,
    agentRuns: agentRows.map((row) => ({
      ...row.agentRun,
      slug: row.slug,
      description: row.description,
      events: eventsByAgentRun.get(row.agentRun.id) ?? [],
      findings: (findingsByAgentRun.get(row.agentRun.id) ?? []).map((entry) => entry.finding),
    })),
  };
}

async function getReplacementRun(
  userId: number,
  run: typeof reviewRun.$inferSelect,
): Promise<{ id: string } | undefined> {
  if (run.status !== 'superseded') return undefined;

  const [replacementRun] = await db
    .select({ id: reviewRun.id })
    .from(reviewRun)
    .where(
      and(
        eq(reviewRun.userId, userId),
        eq(reviewRun.repositoryId, run.repositoryId),
        eq(reviewRun.prNumber, run.prNumber),
        eq(reviewRun.prevHeadSha, run.headSha),
      ),
    )
    .orderBy(asc(reviewRun.startedAt), asc(reviewRun.id))
    .limit(1);

  return replacementRun;
}

export async function stopRun(userId: number, runId: string) {
  const [existingRun] = await db
    .select({ id: reviewRun.id })
    .from(reviewRun)
    .where(and(eq(reviewRun.userId, userId), eq(reviewRun.id, runId)))
    .limit(1);

  if (!existingRun) error(403, 'You do not have access to this run.');

  const stoppedAt = new Date();
  await db.execute(sql`
    WITH stopped_run AS (
      UPDATE ${reviewRun}
      SET
        "status" = 'cancelled',
        "finished_at" = ${stoppedAt},
        "error" = 'Stopped by operator.'
      WHERE ${reviewRun.userId} = ${userId}
        AND ${reviewRun.id} = ${runId}
      RETURNING ${reviewRun.id} AS id
    )
    UPDATE ${agentRun}
    SET
      "status" = 'cancelled',
      "stopped_reason" = 'timeout'
    WHERE ${agentRun.userId} = ${userId}
      AND ${agentRun.reviewRunId} IN (SELECT id FROM stopped_run)
  `);

  await signalEngineStop(runId);

  return { ok: true };
}

export async function stopAgent(userId: number, runId: string, agentId: string) {
  const [existingRun] = await db
    .select({ id: reviewRun.id })
    .from(reviewRun)
    .where(and(eq(reviewRun.userId, userId), eq(reviewRun.id, runId)))
    .limit(1);

  if (!existingRun) error(403, 'You do not have access to this run.');

  const updatedRows = await db
    .update(agentRun)
    .set({
      status: 'cancelled',
      stoppedReason: 'timeout',
    })
    .where(
      and(
        eq(agentRun.userId, userId),
        eq(agentRun.reviewRunId, runId),
        eq(agentRun.agentId, agentId),
      ),
    )
    .returning({ id: agentRun.id });

  if (updatedRows.length === 0) error(404, 'Agent run not found.');

  await signalEngineStopAgent(runId, agentId);

  return { ok: true };
}

async function signalEngineStop(runId: string): Promise<void> {
  if (!env.TRIBUNAL_ENGINE_URL || !env.TRIBUNAL_ENGINE_CONTROL_TOKEN) return;

  try {
    const url = new URL(`/review-runs/${encodeURIComponent(runId)}/stop`, env.TRIBUNAL_ENGINE_URL);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TRIBUNAL_ENGINE_CONTROL_TOKEN}` },
    });
    if (!response.ok && response.status !== 404) {
      console.warn(`Engine stop signal failed with status ${response.status}.`);
    }
  } catch (error) {
    console.warn('Engine stop signal failed.', error);
  }
}

async function signalEngineStopAgent(runId: string, agentId: string): Promise<void> {
  if (!env.TRIBUNAL_ENGINE_URL || !env.TRIBUNAL_ENGINE_CONTROL_TOKEN) return;

  try {
    const url = new URL(
      `/review-runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}/stop`,
      env.TRIBUNAL_ENGINE_URL,
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TRIBUNAL_ENGINE_CONTROL_TOKEN}` },
    });
    if (!response.ok && response.status !== 404) {
      console.warn(`Engine agent stop signal failed with status ${response.status}.`);
    }
  } catch (error) {
    console.warn('Engine agent stop signal failed.', error);
  }
}

export async function getCostOverview(userId: number, source: 'estimate' | 'reconciled') {
  const [settings] = await getUserReviewSettings(userId);
  const rows = await db
    .select({
      event: costEvent,
      agentSlug: agent.slug,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
    })
    .from(costEvent)
    .leftJoin(agent, eq(agent.id, costEvent.agentId))
    .leftJoin(repository, eq(repository.id, costEvent.repositoryId))
    .where(and(eq(costEvent.userId, userId), eq(costEvent.source, source)))
    .orderBy(desc(costEvent.occurredAt));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTotal = rows.reduce(
    (sum, row) => (row.event.occurredAt >= todayStart ? sum + Number(row.event.amountUsd) : sum),
    0,
  );

  return {
    source,
    dailyCostCapUsd: Number(settings.dailyCostCapUsd),
    todayTotalUsd: todayTotal,
    rollups: {
      byReviewRun: rollup(rows, (row) => row.event.reviewRunId ?? 'Unassigned'),
      byPullRequest: rollup(rows, (row) =>
        row.event.reviewRunId ? `Run ${row.event.reviewRunId}` : 'Unassigned',
      ),
      byRepository: rollup(rows, (row) =>
        row.repositoryOwner && row.repositoryName
          ? `${row.repositoryOwner}/${row.repositoryName}`
          : 'Unassigned',
      ),
      byAgent: rollup(rows, (row) => row.agentSlug ?? 'Unassigned'),
      byAgentPerRepository: rollup(rows, (row) => {
        const agentLabel = row.agentSlug ?? 'Unassigned agent';
        const repositoryLabel =
          row.repositoryOwner && row.repositoryName
            ? `${row.repositoryOwner}/${row.repositoryName}`
            : 'Unassigned repository';
        return `${agentLabel} @ ${repositoryLabel}`;
      }),
      byUserPerDay: rollup(
        rows,
        (row) => `${row.event.userId} @ ${row.event.occurredAt.toISOString().slice(0, 10)}`,
      ),
    },
    cacheTokens: rows.reduce(
      (accumulator, row) => {
        const meta = row.event.meta as { cacheReadTokens?: number; cacheCreationTokens?: number };
        accumulator.cacheReadTokens += Number(meta.cacheReadTokens ?? 0);
        accumulator.cacheCreationTokens += Number(meta.cacheCreationTokens ?? 0);
        return accumulator;
      },
      { cacheReadTokens: 0, cacheCreationTokens: 0 },
    ),
  };
}

function rollup<T>(rows: T[], getKey: (row: T) => string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = getKey(row);
    const amount = Number((row as { event: { amountUsd: string } }).event.amountUsd);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return Array.from(totals.entries())
    .map(([label, amountUsd]) => ({ label, amountUsd }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
}

export async function getUserReviewSettings(userId: number) {
  const inserted = await db
    .insert(userReviewSettings)
    .values({ userId })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) return inserted;

  return db.select().from(userReviewSettings).where(eq(userReviewSettings.userId, userId)).limit(1);
}

export async function saveUserReviewSettings(userId: number, formData: FormData) {
  const dailyCostCapUsd = String(formData.get('dailyCostCapUsd') ?? '').trim();
  const defaultModel = String(formData.get('defaultModel') ?? '').trim();
  const reviewsEnabled = formData.get('reviewsEnabled') === 'on';

  if (Number(dailyCostCapUsd) < 0 || !Number.isFinite(Number(dailyCostCapUsd))) {
    return fail(400, { error: 'Daily cost cap must be zero or greater.' });
  }

  if (!agentModelSchema.safeParse(defaultModel).success) {
    return fail(400, { error: 'Default model is invalid.' });
  }

  await db
    .insert(userReviewSettings)
    .values({ userId, dailyCostCapUsd, defaultModel, reviewsEnabled })
    .onConflictDoUpdate({
      target: userReviewSettings.userId,
      set: { dailyCostCapUsd, defaultModel, reviewsEnabled, updatedAt: new Date() },
    });

  return { success: true };
}

export function getReviewModelOptions() {
  return reviewModelOptions;
}

export function getReviewEffortOptions() {
  return reviewEffortOptions;
}

export function validateEffort(value: string) {
  return effortSchema.safeParse(value).success;
}
