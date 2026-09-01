import { and, desc, eq } from 'drizzle-orm';
import { pullRequestReviewRun, repository, tribunalRun } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { buildPage, type Page, type PaginationInput } from '../pagination';

/**
 * A review run's lifecycle, and nothing else.
 *
 * Tribunal's own operator reader, `getRunInspector`, is the obvious thing to
 * reuse and must not be: it queries agent descriptions and agent events
 * alongside the run rows. Those are execution and configuration telemetry, and
 * no scope in this vocabulary grants them — not `reviews:read`, whose consent
 * copy covers status, timing, and cost estimate, and not
 * `review_findings:read`, whose copy covers finding rows. Exposing them at all
 * is a new-scope decision, so they are omitted here rather than routed
 * somewhere else.
 *
 * `workflowId`, `sandboxId`, and the run's internal `error` string are left
 * out for the same reason: infrastructure identifiers and internal failure
 * text are not "status, timing, and cost estimate", which is what the user
 * approved.
 *
 * So are the run's `trigger`, the `headSha` it reviewed, and how many comments
 * it posted. A review review found them beyond the same sentence, and it was
 * right: a token holding `reviews:read` alone would otherwise learn which
 * commit a pull request was at and how much review traffic it drew, without
 * the pull request capability the user could have declined separately.
 *
 * `pullRequestNumber` stays, and the distinction is deliberate rather than
 * convenient: it identifies *which of the caller's own runs* this is, and a
 * review-run tool that cannot say what was reviewed answers nothing. It names
 * the subject; the dropped fields describe it.
 */
export type McpReviewRun = {
  id: string;
  status: string;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  costEstimateUsd: number;
  startedAt: string | null;
  finishedAt: string | null;
};

const reviewRunColumns = {
  id: tribunalRun.id,
  status: tribunalRun.status,
  repositoryId: tribunalRun.repositoryId,
  repositoryOwner: repository.owner,
  repositoryName: repository.name,
  pullRequestNumber: pullRequestReviewRun.prNumber,
  costEstimateUsd: tribunalRun.costEstimateUsd,
  startedAt: tribunalRun.startedAt,
  finishedAt: tribunalRun.finishedAt,
};

type ReviewRunRow = {
  id: string;
  status: string;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  costEstimateUsd: string;
  startedAt: Date | null;
  finishedAt: Date | null;
};

function projectReviewRun(row: ReviewRunRow): McpReviewRun {
  return {
    id: row.id,
    status: row.status,
    repositoryId: row.repositoryId,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    pullRequestNumber: row.pullRequestNumber,
    costEstimateUsd: Number(row.costEstimateUsd),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Lists the caller's own review runs, newest first.
 *
 * Filtered on `tribunal_run.user_id`, so a run belonging to another user is
 * not reachable by guessing an identifier. Paginated rather than capped: the
 * operator reader this replaces ends in an unconditional `LIMIT 50` with no
 * cursor, which would silently omit every run past the fiftieth with nothing
 * in the response saying so.
 */
export async function listReviewRuns(
  userId: number,
  input: PaginationInput & { repositoryId?: number },
): Promise<Page<McpReviewRun>> {
  const filters = [eq(tribunalRun.userId, userId)];
  if (input.repositoryId !== undefined) {
    filters.push(eq(tribunalRun.repositoryId, input.repositoryId));
  }

  const rows = await db
    .select(reviewRunColumns)
    .from(tribunalRun)
    .innerJoin(pullRequestReviewRun, eq(pullRequestReviewRun.runId, tribunalRun.id))
    .innerJoin(repository, eq(repository.id, tribunalRun.repositoryId))
    .where(and(...filters))
    .orderBy(desc(tribunalRun.startedAt), desc(tribunalRun.id))
    .limit(input.limit + 1)
    .offset(input.offset);

  return buildPage(rows.map(projectReviewRun), input);
}

export async function getReviewRun(userId: number, runId: string): Promise<McpReviewRun | null> {
  const [row] = await db
    .select(reviewRunColumns)
    .from(tribunalRun)
    .innerJoin(pullRequestReviewRun, eq(pullRequestReviewRun.runId, tribunalRun.id))
    .innerJoin(repository, eq(repository.id, tribunalRun.repositoryId))
    .where(and(eq(tribunalRun.id, runId), eq(tribunalRun.userId, userId)));

  return row ? projectReviewRun(row) : null;
}
