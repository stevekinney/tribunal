/**
 * Repository event listener queries. All reads/writes are scoped by
 * (userId, repositoryId) so one user's listeners are never visible to or
 * mutable by another.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from '../operators';
import type { Database } from '../connection';
import { agent } from '../schema/agent';
import { eventListenerDelivery } from '../schema/event-listener-delivery';
import { tribunalRun } from '../schema/tribunal-run';
import {
  repositoryEventListener,
  type NewRepositoryEventListener,
  type RepositoryEventListener,
} from '../schema/repository-event-listener';
import { serializeEventListenerFilters, type EventListenerFilters } from './event-listener-filters';
import {
  deriveEventListenerDisplayStatus,
  type EventListenerDisplayStatus,
} from './event-listener-deliveries';

export class EventListenerAgentOwnershipError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} does not belong to this user, or does not exist`);
    this.name = 'EventListenerAgentOwnershipError';
  }
}

/** Throws unless `agentId` exists and belongs to `userId`. */
async function assertAgentOwnedByUser(
  database: Database,
  userId: number,
  agentId: string,
): Promise<void> {
  const [row] = await database
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
    .limit(1);

  if (!row) throw new EventListenerAgentOwnershipError(agentId);
}

export interface CreateEventListenerInput {
  userId: number;
  repositoryId: number;
  name: string;
  eventType: string;
  action?: string | null;
  filters?: EventListenerFilters;
  agentId: string;
  instructionsMarkdown?: string;
  enabled?: boolean;
}

export function createEventListenerId(): string {
  return `listener_${randomUUID()}`;
}

export async function createEventListener(
  database: Database,
  input: CreateEventListenerInput,
): Promise<RepositoryEventListener> {
  await assertAgentOwnedByUser(database, input.userId, input.agentId);

  const values: NewRepositoryEventListener = {
    id: createEventListenerId(),
    userId: input.userId,
    repositoryId: input.repositoryId,
    name: input.name,
    eventType: input.eventType,
    action: input.action ?? null,
    filtersJson: serializeEventListenerFilters(input.filters),
    agentId: input.agentId,
    instructionsMarkdown: input.instructionsMarkdown ?? '',
    enabled: input.enabled ?? true,
  };

  const [row] = await database.insert(repositoryEventListener).values(values).returning();
  return row;
}

export interface UpdateEventListenerInput {
  name?: string;
  eventType?: string;
  action?: string | null;
  filters?: EventListenerFilters;
  agentId?: string;
  instructionsMarkdown?: string;
  enabled?: boolean;
}

/**
 * Update a listener, scoped to the owning user and repository. Returns null
 * if no matching row exists (wrong id, wrong owner, or wrong repository) so
 * callers can distinguish "not found/not yours" from a successful no-op.
 */
export async function updateEventListener(
  database: Database,
  userId: number,
  repositoryId: number,
  listenerId: string,
  input: UpdateEventListenerInput,
): Promise<RepositoryEventListener | null> {
  if (input.agentId !== undefined) {
    await assertAgentOwnedByUser(database, userId, input.agentId);
  }

  const patch: Partial<NewRepositoryEventListener> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.eventType !== undefined) patch.eventType = input.eventType;
  if (input.action !== undefined) patch.action = input.action;
  if (input.filters !== undefined) patch.filtersJson = serializeEventListenerFilters(input.filters);
  if (input.agentId !== undefined) patch.agentId = input.agentId;
  if (input.instructionsMarkdown !== undefined)
    patch.instructionsMarkdown = input.instructionsMarkdown;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const [row] = await database
    .update(repositoryEventListener)
    .set(patch)
    .where(
      and(
        eq(repositoryEventListener.id, listenerId),
        eq(repositoryEventListener.userId, userId),
        eq(repositoryEventListener.repositoryId, repositoryId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function setEventListenerEnabled(
  database: Database,
  userId: number,
  repositoryId: number,
  listenerId: string,
  enabled: boolean,
): Promise<RepositoryEventListener | null> {
  return updateEventListener(database, userId, repositoryId, listenerId, { enabled });
}

/** Returns true if a matching row was deleted. */
export async function deleteEventListener(
  database: Database,
  userId: number,
  repositoryId: number,
  listenerId: string,
): Promise<boolean> {
  const deleted = await database
    .delete(repositoryEventListener)
    .where(
      and(
        eq(repositoryEventListener.id, listenerId),
        eq(repositoryEventListener.userId, userId),
        eq(repositoryEventListener.repositoryId, repositoryId),
      ),
    )
    .returning({ id: repositoryEventListener.id });

  return deleted.length > 0;
}

export async function getEventListener(
  database: Database,
  userId: number,
  repositoryId: number,
  listenerId: string,
): Promise<RepositoryEventListener | null> {
  const [row] = await database
    .select()
    .from(repositoryEventListener)
    .where(
      and(
        eq(repositoryEventListener.id, listenerId),
        eq(repositoryEventListener.userId, userId),
        eq(repositoryEventListener.repositoryId, repositoryId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function listEventListenersForRepository(
  database: Database,
  userId: number,
  repositoryId: number,
): Promise<RepositoryEventListener[]> {
  return database
    .select()
    .from(repositoryEventListener)
    .where(
      and(
        eq(repositoryEventListener.userId, userId),
        eq(repositoryEventListener.repositoryId, repositoryId),
      ),
    );
}

/**
 * Enabled listeners for a repository/event-type pair, unscoped by user --
 * webhook dispatch runs without a request-scoped user, so matching considers
 * every enabled listener the repository's owners have configured.
 *
 * Also excludes listeners whose agent is currently disabled. This is a
 * match-time optimization only, not the authoritative check -- the agent
 * (or the listener) can still be disabled between matching and the dispatch
 * claim, which is why dispatch re-verifies both independently before
 * running anything.
 */
export async function listEnabledListenersForRepositoryEventType(
  database: Database,
  repositoryId: number,
  eventType: string,
): Promise<RepositoryEventListener[]> {
  const rows = await database
    .select({ listener: repositoryEventListener })
    .from(repositoryEventListener)
    .innerJoin(agent, eq(repositoryEventListener.agentId, agent.id))
    .where(
      and(
        eq(repositoryEventListener.repositoryId, repositoryId),
        eq(repositoryEventListener.eventType, eventType),
        eq(repositoryEventListener.enabled, true),
        eq(agent.enabled, true),
      ),
    );

  return rows.map((row) => row.listener);
}

/** The most recent matched delivery for a listener, shaped for display. */
export interface EventListenerLastDelivery {
  id: number;
  matchedAt: Date;
  deliveryStatus: string;
  runId: string | null;
  runStatus: string | null;
  lastError: string | null;
  /** See {@link deriveEventListenerDisplayStatus}. */
  displayStatus: EventListenerDisplayStatus;
}

/** A listener plus enough agent and delivery-history context to render a row. */
export interface EventListenerWithProgress {
  listener: RepositoryEventListener;
  agentSlug: string;
  agentEnabled: boolean;
  lastDelivery: EventListenerLastDelivery | null;
}

/**
 * Listeners for a repository, each paired with its owning agent's slug and
 * its most recent matched delivery (if any). Powers the repository events
 * page's listener rows: name, event/action, agent, enabled state, last
 * match, and last run status.
 *
 * Fetches the latest delivery per listener with one query per listener
 * rather than a window-function join. Repository listener counts are small
 * (operator-configured, not GitHub-scale), so this stays simple and readable
 * rather than reaching for `DISTINCT ON`.
 */
export async function listEventListenersWithProgressForRepository(
  database: Database,
  userId: number,
  repositoryId: number,
): Promise<EventListenerWithProgress[]> {
  const listeners = await listEventListenersForRepository(database, userId, repositoryId);
  if (listeners.length === 0) return [];

  const agentIds = [...new Set(listeners.map((listener) => listener.agentId))];
  const agentRows = await database
    .select({ id: agent.id, slug: agent.slug, enabled: agent.enabled })
    .from(agent)
    .where(and(eq(agent.userId, userId)));
  const agentById = new Map(
    agentRows.filter((row) => agentIds.includes(row.id)).map((row) => [row.id, row]),
  );

  const results: EventListenerWithProgress[] = [];

  for (const listener of listeners) {
    const [deliveryRow] = await database
      .select({
        id: eventListenerDelivery.id,
        matchedAt: eventListenerDelivery.matchedAt,
        deliveryStatus: eventListenerDelivery.status,
        runId: eventListenerDelivery.runId,
        runStatus: tribunalRun.status,
        lastError: eventListenerDelivery.lastError,
      })
      .from(eventListenerDelivery)
      .leftJoin(tribunalRun, eq(eventListenerDelivery.runId, tribunalRun.id))
      .where(eq(eventListenerDelivery.listenerId, listener.id))
      .orderBy(desc(eventListenerDelivery.matchedAt))
      .limit(1);

    const agentRow = agentById.get(listener.agentId);

    results.push({
      listener,
      agentSlug: agentRow?.slug ?? 'unknown-agent',
      agentEnabled: agentRow?.enabled ?? false,
      lastDelivery: deliveryRow
        ? {
            id: deliveryRow.id,
            matchedAt: deliveryRow.matchedAt,
            deliveryStatus: deliveryRow.deliveryStatus,
            runId: deliveryRow.runId,
            runStatus: deliveryRow.runStatus,
            lastError: deliveryRow.lastError,
            displayStatus: deriveEventListenerDisplayStatus(
              deliveryRow.deliveryStatus,
              deliveryRow.runStatus,
            ),
          }
        : null,
    });
  }

  return results;
}
