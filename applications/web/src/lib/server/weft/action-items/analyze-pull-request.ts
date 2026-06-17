/**
 * Pull request analysis activity.
 *
 * Single activity that:
 * 1. Fetches PR conversation state via GitHub GraphQL
 * 2. Parses existing action items block from PR body
 * 3. Derives one action item per review comment (with deterministic summarization)
 * 4. Reconciles new + existing items (preserving human edits)
 * 5. Updates PR description if changed
 *
 * Generation fence (weft#584):
 * A losing ctx.run branch in ctx.race is NOT aborted by Weft — the coordinator
 * AbortSignal is not propagated to the activity executor. This means a superseded
 * analysis can still complete and write stale action items AFTER a newer run has
 * started or finished. To defend against this:
 *
 *   1. The caller passes an `analysisGeneration` counter (monotonically increasing
 *      per orchestrator run) in the activity input.
 *   2. Before the activity WRITES (DB upsert + PR body update) it compares the
 *      PR's current head SHA (fetched fresh at the top of the activity) against
 *      the head SHA stored on the pull_request_state row at write time.
 *   3. If the live head SHA has advanced (i.e. a newer push arrived and a newer
 *      analysis is in flight), the write is SKIPPED and the activity returns a
 *      `generationFenced` flag so the caller can observe the fence tripped.
 *
 * `ctx.signal` is honored cooperatively: it is passed to fetch where possible
 * and checked via throwIfAborted before the write boundary.
 *
 * Adaptation from depict:
 * - DROP the LLM rewrite (depict used Haiku via @lasercat/homogenaize).
 *   deterministicSummary is used instead — fast, zero-cost, no Anthropic dependency.
 * - Tribunal marker namespace: TRIBUNAL-ACTION-ITEMS-START/END, tribunal:ai:{id}
 * - isRepositoryLinkedToProject guard is DROPPED (Tribunal has no project-link table).
 * - Activities close over the module-level githubContext singleton.
 *
 * Concurrency hardening is a documented pre-production gate (see
 * WEFT_MIGRATION_PLAN.md §7, item 5), inert until WEFT_DATABASE_URL is set:
 * the SHA fence does not catch a same-commit supersede; the full-body write can
 * clobber a concurrent edit (re-fetch before write); `synchronize` is not yet
 * dispatched so a fenced run has no guaranteed replacement; GraphQL connections
 * are first-page only. These were surfaced by the review committee and are
 * tracked for the production-enablement increment, not this one.
 */

import { and, eq } from 'drizzle-orm';
import { pullRequestState, pullRequestActionItem } from '@tribunal/database/schema';
import {
  upsertActionItems,
  addActionItemSources,
} from '@tribunal/github/pull-requests/action-items';
import { githubContext } from '$lib/server/github-context';
import {
  parseActionItemsBlock,
  reconcileActionItems,
  updatePRDescription,
} from './action-items.js';
import type { DerivedActionItem, ConversationState } from './action-items.js';
import { computeActionItemStatus } from './compute-action-item-status.js';
import { extractSourceType } from './extract-source-type.js';
import { sanitizeActionItemCandidate } from './sanitization.js';
import { deterministicSummary } from './summarize.js';

// ============================================================================
// TYPES
// ============================================================================

export type AnalyzePullRequestInput = {
  workspaceId: number;
  repositoryId: number;
  prNumber: number;
  installationId: number;
  owner: string;
  repository: string;
  /**
   * Generation fence counter (weft#584).
   *
   * Monotonically increasing per orchestrator run — the orchestrator increments
   * this before each ctx.run('analyzePullRequest', ...) call. On the write path,
   * the activity re-reads pull_request_state.headSha and skips the write if the
   * head SHA has advanced beyond what was fetched at the start of this activity
   * invocation, signalling that a newer analysis generation is already in flight.
   */
  analysisGeneration: number;
};

export type AnalyzePullRequestOutput = {
  updated: boolean;
  actionItemCount: number;
  persisted: boolean;
  /** True when the generation fence fired and the write was skipped. */
  generationFenced?: boolean;
  error?: string;
};

type PRConversationState = {
  title: string;
  body: string;
  isDraft: boolean;
  state: string;
  headSha: string;
  reviews: Array<{
    id: string;
    author: string;
    state: string;
    body: string;
    url: string;
  }>;
  reviewThreads: Array<{
    id: string;
    isResolved: boolean;
    comments: Array<{
      id: string;
      author: string;
      body: string;
      url: string;
    }>;
  }>;
  issueComments: Array<{
    id: string;
    author: string;
    body: string;
    url: string;
  }>;
  ciStatus: {
    overall: string;
    checks: Array<{
      name: string;
      conclusion: string | null;
      status: string;
      detailsUrl: string | null;
    }>;
  };
};

/** Raw item before summarization — carries the full body for deterministicSummary input. */
type RawDerivedItem = {
  id: string;
  body: string;
  completed: boolean;
  sourceRef?: string;
};

// ============================================================================
// ACTIVITY
// ============================================================================

/**
 * Analyze a pull request and upsert derived action items.
 *
 * This is a plain async function suitable for `.activities({ analyzePullRequest: ... })`.
 * It closes over the module-level githubContext singleton, matching the pattern
 * established by syncRepositories in the installation-sync workflow.
 *
 * Generation fence (weft#584): the activity compares the head SHA it fetched from
 * GitHub against the live head SHA on pull_request_state immediately before the
 * write. If they differ, the write is skipped and generationFenced=true is returned.
 */
export async function analyzePullRequest(
  input: AnalyzePullRequestInput,
  signal?: AbortSignal,
): Promise<AnalyzePullRequestOutput> {
  const { db, getInstallationOctokit } = githubContext;
  const { repositoryId, prNumber, installationId, owner, repository: repo } = input;

  // Step 1: Get authenticated client
  signal?.throwIfAborted();
  const octokit = await getInstallationOctokit(installationId);
  if (!octokit) {
    return {
      updated: false,
      actionItemCount: 0,
      persisted: false,
      error: 'Installation not configured',
    };
  }

  // Step 2: Fetch PR conversation state from GitHub
  signal?.throwIfAborted();
  const conversation = await fetchPRConversation(octokit, owner, repo, prNumber, signal);

  // The head SHA fetched from GitHub is our baseline for the generation fence.
  // If this SHA advances by the time we reach the write, a newer push arrived
  // and we should skip the write (weft#584).
  const fetchedHeadSha = conversation.headSha;

  // Step 3: Parse existing action items from PR body
  const existingBlock = parseActionItemsBlock(conversation.body);
  const existingItems = existingBlock?.items ?? [];

  // Step 4: Build conversation state for auto-completion rules
  const conversationState = buildConversationState(conversation);

  // Step 5: Derive raw items and sanitize
  const rawItems = deriveRawItems(conversation);

  const sanitizedItems: Array<RawDerivedItem & { sanitizedBody: string }> = [];
  for (const item of rawItems) {
    const sanitization = sanitizeActionItemCandidate(item.body, item.id);
    if (sanitization.filtered) {
      continue;
    }
    sanitizedItems.push({ ...item, sanitizedBody: sanitization.sanitized });
  }

  // Step 6: Apply deterministic summarization (no LLM — depict adaptation rule #1)
  // deterministicSummary strips markdown prefixes, takes the first non-empty line,
  // truncates at 120 characters. Zero-cost, deterministic, no Anthropic dependency.
  const derivedItems: DerivedActionItem[] = sanitizedItems.map((item) => ({
    id: item.id,
    description: deterministicSummary(item.sanitizedBody),
    completed: item.completed,
    sourceRef: item.sourceRef,
  }));

  // Step 7: Reconcile
  signal?.throwIfAborted();
  const reconciledItems = reconcileActionItems(existingItems, derivedItems, conversationState);

  // Step 7a: Resolve pull request state for DB persistence
  signal?.throwIfAborted();

  const [prStateRow] = await db
    .select({ id: pullRequestState.id, headSha: pullRequestState.headSha })
    .from(pullRequestState)
    .where(
      and(eq(pullRequestState.repositoryId, repositoryId), eq(pullRequestState.prNumber, prNumber)),
    )
    .limit(1);

  if (!prStateRow) {
    // No pullRequestState row: skip DB persistence and PR writeback.
    // This happens when the state table has not yet been populated for the PR
    // (e.g. a webhook arrived before the initial sync completed).
    console.warn(
      `[analyzePullRequest] No pullRequestState row found for repository ${repositoryId}, PR #${prNumber}. Skipping DB persistence and PR writeback.`,
    );
    return { updated: false, actionItemCount: reconciledItems.length, persisted: false };
  }

  // ============================================================================
  // GENERATION FENCE (weft#584)
  //
  // A losing ctx.run branch in ctx.race is NOT aborted by Weft. A superseded
  // analysis can still complete and write stale action items AFTER a newer run
  // has started. We defend against this by comparing the head SHA we fetched
  // from GitHub (fetchedHeadSha) against the live head SHA on pull_request_state.
  //
  // If the live head SHA has advanced — meaning a newer push triggered a newer
  // analysis that is already in flight — we SKIP the write entirely and return
  // generationFenced=true so the caller can observe this.
  //
  // This check runs after we have the prStateRow but BEFORE any writes, so
  // "no prStateRow" (above) is handled independently. We also honour ctx.signal
  // cooperatively here before the mutation boundary.
  // ============================================================================
  const liveHeadSha = prStateRow.headSha;
  if (liveHeadSha && fetchedHeadSha && liveHeadSha !== fetchedHeadSha) {
    // The PR head SHA has advanced since we fetched the conversation. A newer
    // push occurred; skip the write so we don't overwrite fresher data.
    console.info(
      `[analyzePullRequest] Generation fence tripped for repository ${repositoryId}, PR #${prNumber}: ` +
        `fetched headSha=${fetchedHeadSha}, live headSha=${liveHeadSha}. Skipping write (generation=${input.analysisGeneration}).`,
    );
    return {
      updated: false,
      actionItemCount: reconciledItems.length,
      persisted: false,
      generationFenced: true,
    };
  }

  // Null-SHA case: when either SHA is absent we have NO positive evidence that
  // the analysis is current — but absence is not evidence of divergence. A null
  // liveHeadSha is the legitimate first-analysis case (the pull_request_state
  // row exists but no webhook has stamped a head SHA yet); fencing here would
  // block every first analysis. So we proceed, but log it so a stale-write that
  // slips through the unfenced window is observable. (The generation counter in
  // the input correlates which generation proceeded unfenced.)
  if (!liveHeadSha || !fetchedHeadSha) {
    console.warn(
      `[analyzePullRequest] Proceeding WITHOUT a SHA generation fence for repository ${repositoryId}, ` +
        `PR #${prNumber}: fetched headSha=${fetchedHeadSha || '<none>'}, live headSha=${liveHeadSha || '<none>'} ` +
        `(generation=${input.analysisGeneration}). Cannot confirm the analysis is current.`,
    );
  }

  // Cooperative abort check immediately before the mutating write boundary.
  // If the orchestrator has signalled cancellation, stop here so we don't
  // write stale items. (weft#584 — ctx.signal cooperative check.)
  signal?.throwIfAborted();

  // Step 7b: Fetch existing items' firstSeenHeadSha values for status computation
  const existingItemShas = new Map<string, string | null>();
  const existingActionItems = await db
    .select({
      stableKey: pullRequestActionItem.stableKey,
      firstSeenHeadSha: pullRequestActionItem.firstSeenHeadSha,
    })
    .from(pullRequestActionItem)
    .where(eq(pullRequestActionItem.pullRequestStateId, prStateRow.id));

  for (const row of existingActionItems) {
    existingItemShas.set(row.stableKey, row.firstSeenHeadSha);
  }

  // Step 7c: Persist to database
  const actionItemInputs = reconciledItems.map((item) => ({
    stableKey: item.id,
    subject: item.description,
    description: item.description,
    status: computeActionItemStatus({
      completed: item.completed,
      currentHeadSha: prStateRow.headSha,
      existingFirstSeenHeadSha: existingItemShas.get(item.id) ?? null,
    }),
    firstSeenHeadSha: existingItemShas.get(item.id) ?? prStateRow.headSha,
  }));

  const upsertedItems = await upsertActionItems(db, prStateRow.id, actionItemInputs);

  // Add sources for items that have sourceUrls
  for (const upsertedItem of upsertedItems) {
    const reconciledItem = reconciledItems.find((r) => r.id === upsertedItem.stableKey);
    if (reconciledItem?.sourceUrl) {
      await addActionItemSources(db, upsertedItem.id, [
        {
          sourceType: extractSourceType(upsertedItem.stableKey),
          sourceIdentifier: upsertedItem.stableKey,
          sourceUrl: reconciledItem.sourceUrl,
        },
      ]);
    }
  }

  // Cancellation-safety boundary: DB is now authoritative. If cancelled here,
  // the PR description will self-heal on the next analysis cycle.
  signal?.throwIfAborted();

  // Step 8: Update PR description ONLY after successful persistence (DB/PR parity)
  const newBody = updatePRDescription(conversation.body, reconciledItems);

  if (newBody === conversation.body) {
    return { updated: false, actionItemCount: reconciledItems.length, persisted: true };
  }

  // Final abort check immediately before the mutating GitHub write to minimize
  // the race window between cancellation and stale data persistence.
  signal?.throwIfAborted();

  try {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      body: newBody,
    });
  } catch (error) {
    // PR update failed but DB is committed — return partial success
    console.error(
      `[analyzePullRequest] GitHub PR update failed for ${owner}/${repo}#${prNumber}:`,
      error,
    );
    return {
      updated: false,
      actionItemCount: reconciledItems.length,
      persisted: true,
      error: 'github_update_failed',
    };
  }

  return { updated: true, actionItemCount: reconciledItems.length, persisted: true };
}

// ============================================================================
// GITHUB API
// ============================================================================

const PR_CONVERSATION_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        title
        body
        isDraft
        state
        headRefOid
        reviews(first: 100) {
          nodes {
            id
            author { login }
            state
            body
            url
          }
        }
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 50) {
              nodes {
                id
                author { login }
                body
                url
              }
            }
          }
        }
        comments(first: 100) {
          nodes {
            id
            author { login }
            body
            url
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    ... on CheckRun {
                      __typename
                      name
                      conclusion
                      status
                      detailsUrl
                    }
                    ... on StatusContext {
                      __typename
                      context
                      state
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchPRConversation(
  octokit: import('octokit').Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  signal?: AbortSignal,
): Promise<PRConversationState> {
  const response: { repository: { pullRequest: Record<string, unknown> } } = await octokit.graphql(
    PR_CONVERSATION_QUERY,
    {
      owner,
      repo,
      number: prNumber,
      request: signal ? { signal } : undefined,
    },
  );

  const pr = response.repository.pullRequest;

  // Parse reviews
  const reviewNodes = (pr.reviews as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];
  const reviews = reviewNodes.map((r) => ({
    id: String(r.id),
    author: (r.author as { login: string } | null)?.login ?? 'unknown',
    state: String(r.state),
    body: String(r.body ?? ''),
    url: String(r.url ?? ''),
  }));

  // Parse review threads
  const threadNodes = (pr.reviewThreads as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];
  const reviewThreads = threadNodes.map((t) => ({
    id: String(t.id),
    isResolved: Boolean(t.isResolved),
    comments: ((t.comments as { nodes: Array<Record<string, unknown>> })?.nodes ?? []).map((c) => ({
      id: String(c.id),
      author: (c.author as { login: string } | null)?.login ?? 'unknown',
      body: String(c.body ?? ''),
      url: String(c.url ?? ''),
    })),
  }));

  // Parse issue comments
  const commentNodes = (pr.comments as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];
  const issueComments = commentNodes.map((c) => ({
    id: String(c.id),
    author: (c.author as { login: string } | null)?.login ?? 'unknown',
    body: String(c.body ?? ''),
    url: String(c.url ?? ''),
  }));

  // Parse CI status
  const commitNodes = (pr.commits as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];
  const lastCommit = commitNodes[0] as { commit?: Record<string, unknown> } | undefined;
  const rollup = lastCommit?.commit?.statusCheckRollup as Record<string, unknown> | null;
  const ciContexts = (rollup?.contexts as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];

  const checks = ciContexts
    .filter((ctx) => (ctx.__typename as string) === 'CheckRun')
    .map((ctx) => ({
      name: String(ctx.name ?? ''),
      conclusion: ctx.conclusion ? String(ctx.conclusion) : null,
      status: String(ctx.status ?? ''),
      detailsUrl: ctx.detailsUrl ? String(ctx.detailsUrl) : null,
    }));

  const ciStatus = {
    overall: String(rollup?.state ?? 'PENDING'),
    checks,
  };

  // headRefOid is the commit SHA at the head of the PR branch
  const headSha = String(pr.headRefOid ?? '');

  return {
    title: String(pr.title ?? ''),
    body: String(pr.body ?? ''),
    isDraft: Boolean(pr.isDraft),
    state: String(pr.state ?? ''),
    headSha,
    reviews,
    reviewThreads,
    issueComments,
    ciStatus,
  };
}

// ============================================================================
// ACTION ITEM DERIVATION
// ============================================================================

/**
 * Derive raw action items from conversation state.
 *
 * One item per review comment (not per thread), plus CI checks and
 * changes-requested reviews. Bodies are raw — summarization happens later.
 */
/**
 * Make a CI check name safe to embed in a stable key. The key is rendered into
 * a trailing `<!-- tribunal:ai:ci-check-{name} -->` HTML comment in the PR body
 * and re-parsed on the next cycle, so a check name containing `>`, `--`, or
 * whitespace runs (GitHub allows e.g. `CI / test (ubuntu)`) would corrupt the
 * comment and orphan the item. Collapse anything outside `[A-Za-z0-9._-]` to a
 * single `-`. Applied identically on the lookup side (passingCheckNames) so
 * auto-completion still matches.
 */
function safeCheckKeySegment(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function deriveRawItems(conversation: PRConversationState): RawDerivedItem[] {
  const items: RawDerivedItem[] = [];

  // Review comments → one item per comment
  for (const thread of conversation.reviewThreads) {
    for (const comment of thread.comments) {
      items.push({
        id: `review-comment:${thread.id}:${comment.id}`,
        body: comment.body,
        completed: thread.isResolved,
        sourceRef: comment.url || undefined,
      });
    }
  }

  // Failing CI checks → action items
  for (const check of conversation.ciStatus.checks) {
    if (check.conclusion === 'FAILURE' || check.conclusion === 'failure') {
      items.push({
        // Sanitize the check name in the KEY (it gets embedded in an HTML
        // comment in the PR body); keep the raw name in the human-readable body.
        id: `ci-check-${safeCheckKeySegment(check.name)}`,
        body: `Fix CI: ${check.name}`,
        completed: false,
        sourceRef: check.detailsUrl || undefined,
      });
    }
  }

  // Reviews with changes_requested → action item
  for (const review of conversation.reviews) {
    if (review.state === 'CHANGES_REQUESTED' && review.body) {
      items.push({
        id: `review-${review.id}`,
        body: review.body,
        completed: false,
        sourceRef: review.url || undefined,
      });
    }
  }

  // Issue comments → action items
  for (const comment of conversation.issueComments) {
    if (!comment.body.trim()) continue;
    items.push({
      id: `issue-comment-${comment.id}`,
      body: comment.body,
      completed: false,
      sourceRef: comment.url || undefined,
    });
  }

  return items;
}

// ============================================================================
// CONVERSATION STATE BUILDER
// ============================================================================

function buildConversationState(conversation: PRConversationState): ConversationState {
  const resolvedThreadIds = new Set<string>();
  for (const thread of conversation.reviewThreads) {
    if (thread.isResolved) {
      resolvedThreadIds.add(thread.id);
    }
  }

  const passingCheckNames = new Set<string>();
  for (const check of conversation.ciStatus.checks) {
    if (check.conclusion === 'SUCCESS' || check.conclusion === 'success') {
      // Sanitize to match the key form used in deriveRawItems, so the
      // `ci-check-{name}` auto-completion lookup (which strips the prefix and
      // checks this set) compares like-for-like.
      passingCheckNames.add(safeCheckKeySegment(check.name));
    }
  }

  const allChecksPassing =
    conversation.ciStatus.overall === 'SUCCESS' || conversation.ciStatus.overall === 'success';

  return {
    resolvedThreadIds,
    allChecksPassing,
    passingCheckNames,
  };
}
