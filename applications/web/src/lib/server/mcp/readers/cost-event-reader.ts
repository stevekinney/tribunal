import { and, desc, eq, gte } from 'drizzle-orm';
import { agent, costEvent, repository } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { buildPage, type Page, type PaginationInput } from '../pagination';

/** Cost ledger sources. `estimate` is the only one live today. */
export type McpCostEventSource = 'estimate' | 'reconciled';

/**
 * One row of the caller's own cost ledger.
 *
 * Repository owner and name are administrator-chosen strings, so tools
 * returning this carry the untrusted-content framing even though the amounts
 * and timestamps are system-generated. Labels are kept rather than reduced to
 * identifiers because a spending answer without repository names is close to
 * useless, and the framing is the cheaper of the two acceptable resolutions.
 *
 * The row's `meta` payload and its idempotency key are omitted: neither is
 * "estimated review costs by repository and agent", which is what the consent
 * copy describes.
 */
export type McpCostEvent = {
  occurredAt: string;
  amountUsd: number;
  source: string;
  repositoryId: number | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  agentSlug: string | null;
  reviewRunId: string | null;
};

export type McpCostSummary = {
  source: McpCostEventSource;
  windowDays: number;
  since: string;
  eventCount: number;
  totalUsd: number;
  byRepository: Array<{ label: string; amountUsd: number }>;
  byAgent: Array<{ label: string; amountUsd: number }>;
};

const costEventColumns = {
  occurredAt: costEvent.occurredAt,
  amountUsd: costEvent.amountUsd,
  source: costEvent.source,
  repositoryId: costEvent.repositoryId,
  repositoryOwner: repository.owner,
  repositoryName: repository.name,
  agentSlug: agent.slug,
  reviewRunId: costEvent.reviewRunId,
};

type CostEventRow = {
  occurredAt: Date;
  amountUsd: string;
  source: string;
  repositoryId: number | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  agentSlug: string | null;
  reviewRunId: string | null;
};

function projectCostEvent(row: CostEventRow): McpCostEvent {
  return {
    occurredAt: row.occurredAt.toISOString(),
    amountUsd: Number(row.amountUsd),
    source: row.source,
    repositoryId: row.repositoryId,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    agentSlug: row.agentSlug,
    reviewRunId: row.reviewRunId,
  };
}

/**
 * Reads the ledger directly, never through `getCostOverview`.
 *
 * That function's first operation is `getUserReviewSettings`, which performs an
 * `INSERT ... ON CONFLICT DO NOTHING` to create a settings row when none
 * exists. An MCP read that writes contradicts this release's read-only mandate
 * outright and would make a read-scoped token depend on write-capable database
 * access — the exact privilege this vocabulary exists to withhold. So the
 * daily cap it reads is not surfaced here at all; it is a settings value, not
 * a cost event.
 */
function costEventQuery() {
  return db
    .select(costEventColumns)
    .from(costEvent)
    .leftJoin(agent, eq(agent.id, costEvent.agentId))
    .leftJoin(repository, eq(repository.id, costEvent.repositoryId));
}

export async function listCostEvents(
  userId: number,
  input: PaginationInput & { source?: McpCostEventSource },
): Promise<Page<McpCostEvent>> {
  const filters = [eq(costEvent.userId, userId)];
  if (input.source !== undefined) filters.push(eq(costEvent.source, input.source));

  const rows = await costEventQuery()
    .where(and(...filters))
    .orderBy(desc(costEvent.occurredAt))
    .limit(input.limit + 1)
    .offset(input.offset);

  return buildPage(rows.map(projectCostEvent), input);
}

function rollUp(
  events: McpCostEvent[],
  label: (event: McpCostEvent) => string,
): Array<{ label: string; amountUsd: number }> {
  const totals = new Map<string, number>();
  for (const event of events) {
    const key = label(event);
    totals.set(key, (totals.get(key) ?? 0) + event.amountUsd);
  }
  return Array.from(totals.entries())
    .map(([groupLabel, amountUsd]) => ({ label: groupLabel, amountUsd }))
    .sort((left, right) => {
      if (left.amountUsd !== right.amountUsd) return right.amountUsd - left.amountUsd;
      // Ties break on a plain code-point comparison rather than
      // `localeCompare`, so the same ledger produces the same order on every
      // machine that reads it. Labels are `Map` keys, so two of them are
      // never equal and there is no third case to handle.
      return left.label < right.label ? -1 : 1;
    });
}

export async function summarizeCostEvents(
  userId: number,
  input: { source: McpCostEventSource; windowDays: number },
): Promise<McpCostSummary> {
  const since = new Date(Date.now() - input.windowDays * 24 * 60 * 60 * 1000);

  const rows = await costEventQuery()
    .where(
      and(
        eq(costEvent.userId, userId),
        eq(costEvent.source, input.source),
        gte(costEvent.occurredAt, since),
      ),
    )
    .orderBy(desc(costEvent.occurredAt));

  const events = rows.map(projectCostEvent);

  return {
    source: input.source,
    windowDays: input.windowDays,
    since: since.toISOString(),
    eventCount: events.length,
    totalUsd: events.reduce((total, event) => total + event.amountUsd, 0),
    byRepository: rollUp(events, (event) =>
      event.repositoryOwner && event.repositoryName
        ? `${event.repositoryOwner}/${event.repositoryName}`
        : 'Unassigned',
    ),
    byAgent: rollUp(events, (event) => event.agentSlug ?? 'Unassigned'),
  };
}
