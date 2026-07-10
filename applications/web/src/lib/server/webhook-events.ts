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
import {
  eventListenerDelivery,
  repository,
  repositoryEventListener,
  tribunalRun,
  webhookEvent,
} from '@tribunal/database/schema';
import {
  deriveEventListenerDisplayStatus,
  type EventListenerDisplayStatus,
} from '@tribunal/database/queries';

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
  /** Event listener match/dispatch progress for this event. */
  listenerProgress: WebhookEventListenerProgress;
}

export interface WebhookEventListResult {
  events: WebhookEventRow[];
  page: number;
  perPage: number;
  totalCount: number;
}

/** One event listener that matched a webhook event, and its dispatch/run progress. */
export interface WebhookEventListenerMatch {
  listenerId: string;
  listenerName: string;
  /** `event_listener_delivery.status`: pending | running | succeeded | failed | retryable | abandoned. */
  deliveryStatus: string;
  /** Small shared display vocabulary -- see {@link deriveEventListenerDisplayStatus}. */
  status: EventListenerDisplayStatus;
  runId: string | null;
  lastError: string | null;
}

/**
 * Listener-match/dispatch progress for one webhook event, computed by the
 * same helper on both the global and repository-scoped webhook pages.
 *
 * A delivery with no matching listeners is `receivedOnly: true` and must
 * never be presented as an error -- it just means nothing was configured to
 * react to it.
 */
export interface WebhookEventListenerProgress {
  receivedOnly: boolean;
  matchCount: number;
  matchedListenerNames: string[];
  /** Overall status across every match -- see {@link summarizeListenerProgress}. */
  status: 'received_only' | EventListenerDisplayStatus;
  hasError: boolean;
  matches: WebhookEventListenerMatch[];
}

/**
 * Precedence used to reduce multiple listener matches on one event down to a
 * single overall status: surface the most operationally interesting state
 * first (something failed, then something in flight, then something merely
 * queued/matched) and only report a clean terminal state once every match
 * has reached one.
 */
const STATUS_PRECEDENCE: readonly EventListenerDisplayStatus[] = [
  'failed',
  'running',
  'queued',
  'matched',
  'succeeded',
  'cancelled',
];

/** Combines per-listener match statuses into one overall row status. */
export function summarizeListenerProgress(
  matches: readonly Pick<WebhookEventListenerMatch, 'status'>[],
): { status: 'received_only' | EventListenerDisplayStatus; hasError: boolean } {
  if (matches.length === 0) {
    return { status: 'received_only', hasError: false };
  }

  const statuses = new Set(matches.map((match) => match.status));
  const status = STATUS_PRECEDENCE.find((candidate) => statuses.has(candidate)) ?? 'matched';
  const hasError = matches.some((match) => match.status === 'failed');

  return { status, hasError };
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

function toRow(
  row: {
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
  },
  matches: WebhookEventListenerMatch[],
): WebhookEventRow {
  const { payload, parseError } = parseWebhookPayload(row.payload);
  const { status, hasError } = summarizeListenerProgress(matches);
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
    listenerProgress: {
      receivedOnly: matches.length === 0,
      matchCount: matches.length,
      matchedListenerNames: matches.map((match) => match.listenerName),
      status,
      hasError,
      matches,
    },
  };
}

/**
 * Load event listener match/dispatch progress for a batch of webhook event
 * ids, keyed by event id. Shared by every caller of {@link listWebhookEvents}
 * so the global and repository-scoped pages never compute this differently.
 *
 * Scoped to `userId` -- `repository_event_listener` rows belong to the user
 * who created them, and a repository can be added by more than one Tribunal
 * user. Without this predicate, one user could see another user's listener
 * names, errors, and run links for a repository they both happen to access.
 */
async function loadListenerProgressByEventId(
  eventIds: number[],
  userId: number,
): Promise<Map<number, WebhookEventListenerMatch[]>> {
  const progressByEventId = new Map<number, WebhookEventListenerMatch[]>();
  if (eventIds.length === 0) return progressByEventId;

  const rows = await db
    .select({
      webhookEventId: eventListenerDelivery.webhookEventId,
      listenerId: eventListenerDelivery.listenerId,
      listenerName: repositoryEventListener.name,
      deliveryStatus: eventListenerDelivery.status,
      runId: eventListenerDelivery.runId,
      lastError: eventListenerDelivery.lastError,
      runStatus: tribunalRun.status,
    })
    .from(eventListenerDelivery)
    .innerJoin(
      repositoryEventListener,
      eq(eventListenerDelivery.listenerId, repositoryEventListener.id),
    )
    .leftJoin(tribunalRun, eq(eventListenerDelivery.runId, tribunalRun.id))
    .where(
      and(
        inArray(eventListenerDelivery.webhookEventId, eventIds),
        eq(repositoryEventListener.userId, userId),
      ),
    )
    // Deterministic order -- without it, `matchedListenerNames` (and the
    // expanded-row list) can jitter between requests since Postgres makes no
    // ordering guarantee for an unordered join.
    .orderBy(repositoryEventListener.name);

  for (const row of rows) {
    const match: WebhookEventListenerMatch = {
      listenerId: row.listenerId,
      listenerName: row.listenerName,
      deliveryStatus: row.deliveryStatus,
      status: deriveEventListenerDisplayStatus(row.deliveryStatus, row.runStatus),
      runId: row.runId,
      lastError: row.lastError,
    };
    const existing = progressByEventId.get(row.webhookEventId);
    if (existing) {
      existing.push(match);
    } else {
      progressByEventId.set(row.webhookEventId, [match]);
    }
  }

  return progressByEventId;
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
 * `userId` scopes the per-event listener progress (names, errors, run
 * links) to listeners the caller owns -- see
 * {@link loadListenerProgressByEventId}. A repository can be shared by more
 * than one Tribunal user, and `webhookEvent` rows themselves are not
 * per-user, so this predicate is required even though the events list
 * itself is already bounded by `authorizedRepositoryIds`.
 *
 * An empty `authorizedRepositoryIds` array always yields an empty result —
 * it never falls back to "no filter."
 */
export async function listWebhookEvents(
  authorizedRepositoryIds: number[],
  userId: number,
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

  const progressByEventId = await loadListenerProgressByEventId(
    rows.map((row) => row.id),
    userId,
  );

  return {
    events: rows.map((row) => toRow(row, progressByEventId.get(row.id) ?? [])),
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
 * Sorted distinct actions observed per event type for one repository's
 * received webhook events. Powers the repository events page's action
 * choices: once a user picks an event type, offer only the actions actually
 * observed for it, never a guessed or hand-maintained complete action set.
 */
export async function getObservedEventTypeActionMap(
  repositoryId: number,
): Promise<Record<string, string[]>> {
  const rows = await db
    .selectDistinct({ eventType: webhookEvent.eventType, action: webhookEvent.action })
    .from(webhookEvent)
    .where(eq(webhookEvent.repositoryId, repositoryId));

  const map: Record<string, string[]> = {};
  for (const row of rows) {
    if (!row.action) continue;
    (map[row.eventType] ??= []).push(row.action);
  }
  for (const eventType of Object.keys(map)) {
    map[eventType] = [...new Set(map[eventType])].sort();
  }

  return map;
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
