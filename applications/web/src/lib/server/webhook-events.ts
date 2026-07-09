/**
 * Read/presentation helper for stored webhook events.
 *
 * This is a query layer only — webhook storage lives in
 * `packages/github/src/webhooks/webhook-events.ts` and must not be duplicated
 * here. This module reads the same `webhook_event` table for the global and
 * repository-scoped webhook event pages.
 *
 * Authorization is caller-driven: every query takes the caller's authorized
 * repository IDs and never returns rows outside that set, even when a fixed
 * `repositoryId` is also supplied for a repository-scoped page.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/database';
import { repository, webhookEvent } from '@tribunal/database/schema';

/** Filters accepted by {@link listWebhookEvents}. */
export interface WebhookEventFilters {
  eventType?: string;
  action?: string;
  repositoryId?: number;
  prNumber?: number;
  issueNumber?: number;
  senderLogin?: string;
  ref?: string;
  deliveryId?: string;
  page?: number;
  perPage?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * A stored webhook event shaped for display, including a non-throwing parse
 * of its JSON payload.
 *
 * Row shaping (including payload parsing) happens here — the layer this
 * module owns — rather than in the route or the Svelte page, so both the
 * global and repository-scoped pages get identical, tested behavior for
 * malformed payloads.
 */
export interface WebhookEventRow {
  id: number;
  eventType: string;
  action: string | null;
  deliveryId: string | null;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  installationId: number | null;
  senderLogin: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  ref: string | null;
  commitSha: string | null;
  receivedAt: string;
  githubCreatedAt: string | null;
  /** Raw stored payload text, always available for copy/debugging. */
  rawPayload: string;
  /** Parsed payload, or `null` when parsing failed. */
  payload: unknown | null;
  /** True when `payload` is `null` because the stored text was not valid JSON. */
  payloadParseError: boolean;
}

export interface WebhookEventListResult {
  events: WebhookEventRow[];
  page: number;
  perPage: number;
  totalCount: number;
}

/**
 * Parse a stored webhook payload without ever throwing. Isolated here so
 * malformed payloads (which should not happen, but are not guaranteed by the
 * database) cannot fail a page load.
 */
function parseWebhookPayload(rawPayload: string): { payload: unknown | null; parseError: boolean } {
  try {
    return { payload: JSON.parse(rawPayload), parseError: false };
  } catch {
    return { payload: null, parseError: true };
  }
}

function toRow(row: {
  id: number;
  eventType: string;
  action: string | null;
  deliveryId: string | null;
  payload: string;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  installationId: number | null;
  senderLogin: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  ref: string | null;
  commitSha: string | null;
  receivedAt: Date;
  githubCreatedAt: Date | null;
}): WebhookEventRow {
  const { payload, parseError } = parseWebhookPayload(row.payload);
  return {
    id: row.id,
    eventType: row.eventType,
    action: row.action,
    deliveryId: row.deliveryId,
    repositoryId: row.repositoryId,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    installationId: row.installationId,
    senderLogin: row.senderLogin,
    prNumber: row.prNumber,
    issueNumber: row.issueNumber,
    ref: row.ref,
    commitSha: row.commitSha,
    receivedAt: row.receivedAt.toISOString(),
    githubCreatedAt: row.githubCreatedAt ? row.githubCreatedAt.toISOString() : null,
    rawPayload: row.payload,
    payload,
    payloadParseError: parseError,
  };
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.floor(page));
}

function clampPerPage(perPage: number | undefined): number {
  if (!perPage || !Number.isFinite(perPage)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(perPage)));
}

/**
 * Build the shared WHERE clause for both the count and page queries.
 *
 * `authorizedRepositoryIds` is always applied — even when `fixedRepositoryId`
 * is also supplied — so a caller can never widen visibility by passing a
 * `repositoryId` filter outside their authorized set.
 */
function buildWhereClause(
  authorizedRepositoryIds: number[],
  fixedRepositoryId: number | undefined,
  filters: WebhookEventFilters,
): SQL | undefined {
  const conditions: SQL[] = [inArray(webhookEvent.repositoryId, authorizedRepositoryIds)];

  const effectiveRepositoryId = fixedRepositoryId ?? filters.repositoryId;
  if (effectiveRepositoryId !== undefined) {
    conditions.push(eq(webhookEvent.repositoryId, effectiveRepositoryId));
  }
  if (filters.eventType) {
    conditions.push(eq(webhookEvent.eventType, filters.eventType));
  }
  if (filters.action) {
    conditions.push(eq(webhookEvent.action, filters.action));
  }
  if (filters.prNumber !== undefined) {
    conditions.push(eq(webhookEvent.prNumber, filters.prNumber));
  }
  if (filters.issueNumber !== undefined) {
    conditions.push(eq(webhookEvent.issueNumber, filters.issueNumber));
  }
  if (filters.senderLogin) {
    conditions.push(eq(webhookEvent.senderLogin, filters.senderLogin));
  }
  if (filters.ref) {
    conditions.push(eq(webhookEvent.ref, filters.ref));
  }
  if (filters.deliveryId) {
    conditions.push(eq(webhookEvent.deliveryId, filters.deliveryId));
  }

  return and(...conditions);
}

/**
 * List webhook events visible to the caller, joined to repository identity.
 *
 * `authorizedRepositoryIds` scopes every result — pass the caller's
 * `getRepositoriesForUser(user.id)` repository IDs. Pass `fixedRepositoryId`
 * for repository-scoped pages; it narrows the query further but never
 * bypasses the authorized-set check (the caller must still have separately
 * confirmed access to that repository, e.g. via `userCanAccessRepository`).
 *
 * An empty `authorizedRepositoryIds` array always yields an empty result —
 * it never falls back to "no filter."
 */
export async function listWebhookEvents(
  authorizedRepositoryIds: number[],
  filters: WebhookEventFilters = {},
  fixedRepositoryId?: number,
): Promise<WebhookEventListResult> {
  const requestedPage = clampPage(filters.page);
  const perPage = clampPerPage(filters.perPage);

  if (authorizedRepositoryIds.length === 0) {
    return { events: [], page: requestedPage, perPage, totalCount: 0 };
  }

  const whereClause = buildWhereClause(authorizedRepositoryIds, fixedRepositoryId, filters);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEvent)
    .where(whereClause);
  const totalCount = countRow?.count ?? 0;

  if (totalCount === 0) {
    return { events: [], page: requestedPage, perPage, totalCount: 0 };
  }

  // A stale bookmark, back-navigation, or a filter change that shrank the
  // result set can request a page beyond the last valid one. Clamp to the
  // last valid page rather than returning a spuriously empty page.
  const lastValidPage = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(requestedPage, lastValidPage);

  const rows = await db
    .select({
      id: webhookEvent.id,
      eventType: webhookEvent.eventType,
      action: webhookEvent.action,
      deliveryId: webhookEvent.deliveryId,
      payload: webhookEvent.payload,
      repositoryId: webhookEvent.repositoryId,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      installationId: webhookEvent.installationId,
      senderLogin: webhookEvent.senderLogin,
      prNumber: webhookEvent.prNumber,
      issueNumber: webhookEvent.issueNumber,
      ref: webhookEvent.ref,
      commitSha: webhookEvent.commitSha,
      receivedAt: webhookEvent.receivedAt,
      githubCreatedAt: webhookEvent.githubCreatedAt,
    })
    .from(webhookEvent)
    .innerJoin(repository, eq(repository.id, webhookEvent.repositoryId))
    .where(whereClause)
    .orderBy(desc(webhookEvent.receivedAt), desc(webhookEvent.id))
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    events: rows.map(toRow),
    page,
    perPage,
    totalCount,
  };
}

/** Filter options derived from stored events, plus (when available) subscribed App events. */
export interface WebhookEventFilterOptions {
  eventTypes: string[];
  actions: string[];
}

/**
 * Derive filter dropdown options from stored received events for the
 * caller's authorized (optionally fixed-repository) scope, merged with the
 * App's currently subscribed event types when the caller has them available.
 *
 * Deliberately does NOT depend on any "all possible webhook events" catalog —
 * per the Phase Two plan, filters must come from received events and
 * subscribed events only.
 */
export async function getWebhookEventFilterOptions(
  authorizedRepositoryIds: number[],
  fixedRepositoryId?: number,
  subscribedEventTypes: string[] = [],
): Promise<WebhookEventFilterOptions> {
  if (authorizedRepositoryIds.length === 0) {
    return {
      eventTypes: [...new Set(subscribedEventTypes)].sort(),
      actions: [],
    };
  }

  const whereClause = buildWhereClause(authorizedRepositoryIds, fixedRepositoryId, {});

  const [eventTypeRows, actionRows] = await Promise.all([
    db.selectDistinct({ eventType: webhookEvent.eventType }).from(webhookEvent).where(whereClause),
    db.selectDistinct({ action: webhookEvent.action }).from(webhookEvent).where(whereClause),
  ]);

  const eventTypes = new Set(subscribedEventTypes);
  for (const row of eventTypeRows) eventTypes.add(row.eventType);

  const actions = new Set<string>();
  for (const row of actionRows) {
    if (row.action) actions.add(row.action);
  }

  return {
    eventTypes: [...eventTypes].sort(),
    actions: [...actions].sort(),
  };
}

/**
 * Parse webhook event query-string filters using the same `webhook_` prefix
 * convention as the pull request route's `pr_` filters.
 */
export function parseWebhookEventFilters(url: URL): WebhookEventFilters {
  const eventType = url.searchParams.get('webhook_event_type') ?? undefined;
  const action = url.searchParams.get('webhook_action') ?? undefined;
  const repositoryIdRaw = url.searchParams.get('webhook_repository_id');
  const senderLogin = url.searchParams.get('webhook_sender') ?? undefined;
  const ref = url.searchParams.get('webhook_ref') ?? undefined;
  const deliveryId = url.searchParams.get('webhook_delivery_id') ?? undefined;
  const prNumberRaw = url.searchParams.get('webhook_pr_number');
  const issueNumberRaw = url.searchParams.get('webhook_issue_number');
  const page = Math.max(1, parseInt(url.searchParams.get('webhook_page') ?? '1', 10) || 1);
  const perPage = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(url.searchParams.get('webhook_per_page') ?? String(DEFAULT_PAGE_SIZE), 10) ||
        DEFAULT_PAGE_SIZE,
    ),
  );

  const repositoryId = repositoryIdRaw ? parseInt(repositoryIdRaw, 10) : undefined;
  const prNumber = prNumberRaw ? parseInt(prNumberRaw, 10) : undefined;
  const issueNumber = issueNumberRaw ? parseInt(issueNumberRaw, 10) : undefined;

  return {
    eventType: eventType || undefined,
    action: action || undefined,
    repositoryId:
      repositoryId !== undefined && Number.isFinite(repositoryId) ? repositoryId : undefined,
    prNumber: prNumber !== undefined && Number.isFinite(prNumber) ? prNumber : undefined,
    issueNumber:
      issueNumber !== undefined && Number.isFinite(issueNumber) ? issueNumber : undefined,
    senderLogin: senderLogin || undefined,
    ref: ref || undefined,
    deliveryId: deliveryId || undefined,
    page,
    perPage,
  };
}
