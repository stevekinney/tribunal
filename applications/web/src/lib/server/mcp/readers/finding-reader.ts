import { and, desc, eq } from 'drizzle-orm';
import {
  agentRun,
  finding,
  pullRequestReviewRun,
  repository,
  tribunalRun,
} from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { buildPage, type Page, type PaginationInput } from '../pagination';

/**
 * A finding as an MCP client sees it.
 *
 * `title`, `body`, and `suggestion` are a reviewer agent's own prose about
 * specific pull request content, so they can quote — and, if the agent was
 * misled during the review, repeat — text an attacker put in the pull request.
 * Every tool returning this projection carries the untrusted-content framing.
 *
 * Deliberately absent: the agent description snapshot and agent events that
 * `getRunInspector` returns alongside findings (no scope grants them),
 * `verificationNote`, and Tribunal's own posting bookkeeping — `fingerprint`,
 * `mergedFingerprints`, `anchored`, `githubCommentId`. This scope's consent
 * copy covers severity, file location, and suggested fixes.
 */
export type McpReviewFinding = {
  id: string;
  runId: string;
  agentRunId: string;
  agentSlug: string;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number | null;
  path: string;
  startLine: number | null;
  endLine: number | null;
  side: string;
  severity: string;
  title: string;
  body: string;
  suggestion: string | null;
  verificationStatus: string;
  createdAt: string;
};

const findingColumns = {
  id: finding.id,
  runId: tribunalRun.id,
  agentRunId: finding.agentRunId,
  agentSlug: agentRun.agentSlug,
  repositoryId: tribunalRun.repositoryId,
  repositoryOwner: repository.owner,
  repositoryName: repository.name,
  pullRequestNumber: pullRequestReviewRun.prNumber,
  path: finding.path,
  startLine: finding.startLine,
  endLine: finding.endLine,
  side: finding.side,
  severity: finding.severity,
  title: finding.title,
  body: finding.body,
  suggestion: finding.suggestion,
  verificationStatus: finding.verificationStatus,
  createdAt: finding.createdAt,
};

type FindingRow = Omit<McpReviewFinding, 'createdAt'> & { createdAt: Date };

function projectFinding(row: FindingRow): McpReviewFinding {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Every findings read filters on `finding.user_id`.
 *
 * Holding `review_findings:read` proves the user consented to the capability;
 * it proves nothing about whether a caller-supplied run or finding identifier
 * belongs to them. Without this predicate both tools below are a cross-tenant
 * read, and there is no existing findings reader whose safety they could
 * inherit.
 */
function ownedBy(userId: number) {
  return eq(finding.userId, userId);
}

function findingQuery() {
  return db
    .select(findingColumns)
    .from(finding)
    .innerJoin(agentRun, eq(agentRun.id, finding.agentRunId))
    .innerJoin(tribunalRun, eq(tribunalRun.id, agentRun.runId))
    .innerJoin(repository, eq(repository.id, tribunalRun.repositoryId))
    .leftJoin(pullRequestReviewRun, eq(pullRequestReviewRun.runId, tribunalRun.id));
}

export async function listReviewFindings(
  userId: number,
  input: PaginationInput & { runId?: string; severity?: string },
): Promise<Page<McpReviewFinding>> {
  const filters = [ownedBy(userId)];
  if (input.runId !== undefined) filters.push(eq(tribunalRun.id, input.runId));
  if (input.severity !== undefined) filters.push(eq(finding.severity, input.severity));

  const rows = await findingQuery()
    .where(and(...filters))
    .orderBy(desc(finding.createdAt), desc(finding.id))
    .limit(input.limit + 1)
    .offset(input.offset);

  return buildPage(rows.map(projectFinding), input);
}

export async function getReviewFinding(
  userId: number,
  findingId: string,
): Promise<McpReviewFinding | null> {
  const [row] = await findingQuery().where(and(ownedBy(userId), eq(finding.id, findingId)));
  return row ? projectFinding(row) : null;
}
