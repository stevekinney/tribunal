import { and, count, desc, eq, gte, sql, sum } from 'drizzle-orm';
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
  source: McpCostEventSource;
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
    // `cost_event.source` carries a check constraint admitting exactly these
    // two values, so the column cannot hold anything else. Should a migration
    // ever widen it without widening this vocabulary, the tool's own output
    // schema rejects the response — a loud failure rather than a client
    // quietly handed a source it was told could not exist.
    source: row.source as McpCostEventSource,
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
    // The idempotency key is this table's primary key, and it breaks ties on
    // `occurredAt`. Without it, rows sharing a timestamp have no defined order
    // between two `OFFSET` queries, so paging a busy ledger can repeat one
    // event and skip another while `hasMore` still looks correct.
    .orderBy(desc(costEvent.occurredAt), desc(costEvent.idempotencyKey))
    .limit(input.limit + 1)
    .offset(input.offset);

  return buildPage(rows.map(projectCostEvent), input);
}

/**
 * Orders an already-aggregated rollup: largest spend first, ties broken on a
 * plain code-point comparison rather than `localeCompare`, so the same ledger
 * produces the same order on every machine that reads it.
 *
 * Exported because it is the only part of the summary whose ordering does not
 * come from the database: `GROUP BY` returns its rows in whatever order the
 * planner produces, so this comparator — and both directions of its tie-break
 * — is what a test has to pin directly rather than through a query whose input
 * order it cannot choose.
 */
export function orderCostRollup(
  rollup: Array<{ label: string; amountUsd: number }>,
): Array<{ label: string; amountUsd: number }> {
  return rollup.sort((left, right) => {
    if (left.amountUsd !== right.amountUsd) return right.amountUsd - left.amountUsd;
    return left.label < right.label ? -1 : 1;
  });
}

/** `SUM` returns `null` for an empty group and a `numeric` string otherwise. */
function toAmount(total: string | null): number {
  return Number(total ?? 0);
}

/**
 * Summarizes the caller's ledger in one statement.
 *
 * Three reasons, and none is style. A 365-day window on a busy account would
 * otherwise transfer every matching row plus its joined repository and agent
 * into the process just to produce three numbers, so the cost of a small
 * summary would grow with the size of the whole ledger. Summing `numeric`
 * amounts by converting each row to a JavaScript number first reintroduces
 * binary floating point one row at a time — `0.1` and `0.2` come back as
 * `0.30000000000000004`. And three separately dispatched statements see three
 * PostgreSQL snapshots on the HTTP driver, so an insert landing mid-summary
 * could leave `totalUsd` disagreeing with the rollups it is supposed to total.
 *
 * `GROUPING SETS` answers all three: one statement, one snapshot, arithmetic
 * left in `numeric` until the end. `GROUPING()` reports which set each row came
 * from — without it, a repository legitimately named `Unassigned` would be
 * indistinguishable from the grand-total row.
 */
export async function summarizeCostEvents(
  userId: number,
  input: { source: McpCostEventSource; windowDays: number },
): Promise<McpCostSummary> {
  const since = new Date(Date.now() - input.windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      agentSlug: agent.slug,
      repositoryGrouped: sql<number>`grouping(${repository.owner}, ${repository.name})`,
      agentGrouped: sql<number>`grouping(${agent.slug})`,
      eventCount: count(),
      totalUsd: sum(costEvent.amountUsd),
    })
    .from(costEvent)
    .leftJoin(agent, eq(agent.id, costEvent.agentId))
    .leftJoin(repository, eq(repository.id, costEvent.repositoryId))
    .where(
      and(
        eq(costEvent.userId, userId),
        eq(costEvent.source, input.source),
        gte(costEvent.occurredAt, since),
      ),
    )
    .groupBy(sql`grouping sets ((${repository.owner}, ${repository.name}), (${agent.slug}), ())`);

  // Folded in one pass rather than filtered three times, and with the totals
  // seeded at zero rather than read back through an optional: `GROUPING SETS`
  // always returns the grand-total row, so an optional access there would be a
  // branch no test could reach and no reader could explain.
  let eventCount = 0;
  let totalUsd: string | null = null;
  const byRepository: Array<{ label: string; amountUsd: number }> = [];
  const byAgent: Array<{ label: string; amountUsd: number }> = [];

  for (const row of rows) {
    if (row.repositoryGrouped === 0) {
      byRepository.push({
        // `repository.owner` and `repository.name` are both non-null columns,
        // so the only way either is missing is the left join finding no row —
        // a cost event whose repository was deleted. That is one group, not
        // several.
        label:
          row.repositoryOwner && row.repositoryName
            ? `${row.repositoryOwner}/${row.repositoryName}`
            : 'Unassigned',
        amountUsd: toAmount(row.totalUsd),
      });
      continue;
    }

    if (row.agentGrouped === 0) {
      byAgent.push({ label: row.agentSlug ?? 'Unassigned', amountUsd: toAmount(row.totalUsd) });
      continue;
    }

    eventCount = row.eventCount;
    totalUsd = row.totalUsd;
  }

  return {
    source: input.source,
    windowDays: input.windowDays,
    since: since.toISOString(),
    eventCount,
    totalUsd: toAmount(totalUsd),
    byRepository: orderCostRollup(byRepository),
    byAgent: orderCostRollup(byAgent),
  };
}
