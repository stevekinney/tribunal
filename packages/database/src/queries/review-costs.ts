import { and, asc, eq, gte, lt, sql } from '../operators';
import type { Database } from '../connection';
import { costEvent, pullRequestReviewRun } from '../schema';

export type CostEventSource = 'estimate' | 'reconciled';

export interface CostRollupOptions {
  userId: number;
  source?: CostEventSource;
}

export interface ReviewRunCostRollup {
  reviewRunId: string | null;
  amountUsd: number;
}

export interface PullRequestCostRollup {
  repositoryId: number | null;
  prNumber: number | null;
  amountUsd: number;
}

export interface RepositoryCostRollup {
  repositoryId: number | null;
  amountUsd: number;
}

/**
 * Attribution is by `cost_event.agent_label`, the snapshot written at insert time,
 * not by the nullable `agent_id`. `agent_id` is set to null when its agent is
 * deleted, which would merge that agent's historical spend with sandbox costs and
 * with every other deleted agent under a single null bucket. `''` means genuinely
 * no configured agent (sandbox, triage, verifier) and reads back as "Unassigned".
 */
export interface AgentCostRollup {
  agentLabel: string;
  amountUsd: number;
}

export interface AgentRepositoryCostRollup {
  agentLabel: string;
  repositoryId: number | null;
  amountUsd: number;
}

export interface UserDayCostRollup {
  userId: number;
  day: Date;
  amountUsd: number;
}

const amountSql = sql<string>`coalesce(sum(${costEvent.amountUsd}), 0)`;

function toNumber(value: string | number | null): number {
  return Number(value ?? 0);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function rollupWhere(options: CostRollupOptions) {
  return and(
    eq(costEvent.userId, options.userId),
    options.source ? eq(costEvent.source, options.source) : undefined,
  );
}

export async function getCostPerReviewRun(
  database: Database,
  options: CostRollupOptions,
): Promise<ReviewRunCostRollup[]> {
  let query = database
    .select({ reviewRunId: costEvent.reviewRunId, amountUsd: amountSql })
    .from(costEvent)
    .$dynamic();

  const where = rollupWhere(options);
  if (where) query = query.where(where);

  const rows = await query.groupBy(costEvent.reviewRunId).orderBy(asc(costEvent.reviewRunId));
  return rows.map((row) => ({ reviewRunId: row.reviewRunId, amountUsd: toNumber(row.amountUsd) }));
}

export async function getCostPerPullRequest(
  database: Database,
  options: CostRollupOptions,
): Promise<PullRequestCostRollup[]> {
  let query = database
    .select({
      repositoryId: pullRequestReviewRun.repositoryId,
      prNumber: pullRequestReviewRun.prNumber,
      amountUsd: amountSql,
    })
    .from(costEvent)
    .leftJoin(pullRequestReviewRun, eq(costEvent.reviewRunId, pullRequestReviewRun.runId))
    .$dynamic();

  const where = rollupWhere(options);
  if (where) query = query.where(where);

  const rows = await query
    .groupBy(pullRequestReviewRun.repositoryId, pullRequestReviewRun.prNumber)
    .orderBy(asc(pullRequestReviewRun.repositoryId), asc(pullRequestReviewRun.prNumber));
  return rows.map((row) => ({
    repositoryId: row.repositoryId,
    prNumber: row.prNumber,
    amountUsd: toNumber(row.amountUsd),
  }));
}

export async function getCostPerRepository(
  database: Database,
  options: CostRollupOptions,
): Promise<RepositoryCostRollup[]> {
  let query = database
    .select({ repositoryId: costEvent.repositoryId, amountUsd: amountSql })
    .from(costEvent)
    .$dynamic();

  const where = rollupWhere(options);
  if (where) query = query.where(where);

  const rows = await query.groupBy(costEvent.repositoryId).orderBy(asc(costEvent.repositoryId));
  return rows.map((row) => ({
    repositoryId: row.repositoryId,
    amountUsd: toNumber(row.amountUsd),
  }));
}

export async function getCostPerAgent(
  database: Database,
  options: CostRollupOptions,
): Promise<AgentCostRollup[]> {
  let query = database
    .select({ agentLabel: costEvent.agentLabel, amountUsd: amountSql })
    .from(costEvent)
    .$dynamic();

  const where = rollupWhere(options);
  if (where) query = query.where(where);

  const rows = await query.groupBy(costEvent.agentLabel).orderBy(asc(costEvent.agentLabel));
  return rows.map((row) => ({ agentLabel: row.agentLabel, amountUsd: toNumber(row.amountUsd) }));
}

export async function getCostPerAgentPerRepository(
  database: Database,
  options: CostRollupOptions,
): Promise<AgentRepositoryCostRollup[]> {
  let query = database
    .select({
      agentLabel: costEvent.agentLabel,
      repositoryId: costEvent.repositoryId,
      amountUsd: amountSql,
    })
    .from(costEvent)
    .$dynamic();

  const where = rollupWhere(options);
  if (where) query = query.where(where);

  const rows = await query
    .groupBy(costEvent.agentLabel, costEvent.repositoryId)
    .orderBy(asc(costEvent.agentLabel), asc(costEvent.repositoryId));
  return rows.map((row) => ({
    agentLabel: row.agentLabel,
    repositoryId: row.repositoryId,
    amountUsd: toNumber(row.amountUsd),
  }));
}

export async function getCostPerUserPerDay(
  database: Database,
  options: CostRollupOptions,
): Promise<UserDayCostRollup[]> {
  const daySql = sql<Date | string>`date_trunc('day', ${costEvent.occurredAt})`;
  let query = database
    .select({ userId: costEvent.userId, day: daySql, amountUsd: amountSql })
    .from(costEvent)
    .$dynamic();

  const where = rollupWhere(options);
  if (where) query = query.where(where);

  const rows = await query.groupBy(costEvent.userId, daySql).orderBy(asc(costEvent.userId), daySql);
  return rows.map((row) => ({
    userId: row.userId,
    day: toDate(row.day),
    amountUsd: toNumber(row.amountUsd),
  }));
}

export async function spendTodayEstimate(
  database: Database,
  userId: number,
  now = new Date(),
): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfDay);
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);

  const [row] = await database
    .select({ amountUsd: amountSql })
    .from(costEvent)
    .where(
      and(
        eq(costEvent.userId, userId),
        eq(costEvent.source, 'estimate'),
        gte(costEvent.occurredAt, startOfDay),
        lt(costEvent.occurredAt, startOfTomorrow),
      ),
    );

  return toNumber(row?.amountUsd ?? 0);
}
