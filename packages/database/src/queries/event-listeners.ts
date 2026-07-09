/**
 * Repository event listener queries. All reads/writes are scoped by
 * (userId, repositoryId) so one user's listeners are never visible to or
 * mutable by another.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from '../operators';
import type { Database } from '../connection';
import { agent } from '../schema/agent';
import { githubInstallation } from '../schema/github-installation';
import { githubInstallationRepository } from '../schema/github-installation-repository';
import {
  repositoryEventListener,
  type NewRepositoryEventListener,
  type RepositoryEventListener,
} from '../schema/repository-event-listener';
import { serializeEventListenerFilters, type EventListenerFilters } from './event-listener-filters';

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
 * Scoped to listeners whose owning user still has *active* installation
 * access to the repository (an active `github_installation` row joined
 * through an active `github_installation_repository` link, both owned by
 * the listener's `userId`). Installation deletion only removes the
 * `github_installation`/link rows -- the `repository` row (and any listener
 * referencing it) survives, since other installations may still reference
 * the same GitHub repository. Without this check, a listener created by a
 * user who has since lost access (or whose installation was removed and the
 * repository later reinstalled by a different Tribunal user) would still
 * match and dispatch that other user's agent against a repository the
 * original listener owner no longer has access to.
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
    .innerJoin(
      githubInstallationRepository,
      eq(githubInstallationRepository.repositoryId, repositoryEventListener.repositoryId),
    )
    .innerJoin(
      githubInstallation,
      and(
        eq(githubInstallation.installationId, githubInstallationRepository.installationId),
        eq(githubInstallation.userId, repositoryEventListener.userId),
      ),
    )
    .where(
      and(
        eq(repositoryEventListener.repositoryId, repositoryId),
        eq(repositoryEventListener.eventType, eventType),
        eq(repositoryEventListener.enabled, true),
        eq(githubInstallation.status, 'active'),
        eq(githubInstallationRepository.isActive, true),
        eq(agent.enabled, true),
      ),
    );

  return rows.map((row) => row.listener);
}
