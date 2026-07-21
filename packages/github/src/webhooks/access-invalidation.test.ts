import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMemberAddedEvent,
  createMemberRemovedEvent,
  createMemberEditedEvent,
  createRepositoryPrivatizedEvent,
  createRepositoryPublicizedEvent,
  createRepositoryTransferredEvent,
  createRepositoryArchivedEvent,
  createRepositoryUnarchivedEvent,
  createRepositoryDeletedEvent,
  createTeamAddedToRepositoryEvent,
  createTeamRemovedFromRepositoryEvent,
  createInstallationRepositoriesAddedEvent,
  createInstallationRepositoriesRemovedEvent,
  createOrganizationMemberAddedEvent,
  createOrganizationMemberRemovedEvent,
  createMembershipAddedEvent,
  createMembershipRemovedEvent,
  createPublicEvent,
} from 'github-webhook-schemas/fixtures';
import type { GithubServiceContext } from '../context.js';
import type { WebhookPayload } from './types.js';

const mockGetRepositoryIdsByOwner = vi.fn().mockResolvedValue([]);

vi.mock('../repositories/service.js', () => ({
  getRepositoryIdsByOwner: (...args: unknown[]) => mockGetRepositoryIdsByOwner(...args),
}));

const { invalidateGitHubAccessCacheForEvent } = await import('./access-invalidation.js');

/**
 * These fixtures produce real, schema-valid payloads (as opposed to hand-rolled
 * literals) since `access-invalidation.ts` gates almost every branch on a Zod
 * type guard -- an invalid shape would make the guard silently return false
 * and the test would falsely pass by asserting "nothing happened". The
 * module's own guards only care about a handful of fields, not the full
 * generic index signature `WebhookPayload` declares, so the cast here is
 * narrowing a real, validated fixture object down to the loose payload type
 * the function accepts.
 */
function asPayload(data: unknown): WebhookPayload {
  return data as WebhookPayload;
}

/**
 * A full "minimal repository" shape. `createTeamAddedToRepositoryEvent` and
 * the installation_repositories fixtures default their repository field(s) to
 * absent/empty, so tests that need a populated one must supply every field
 * the schema requires themselves.
 */
function fullRepository(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    node_id: `node_${id}`,
    name: `repo-${id}`,
    full_name: `acme/repo-${id}`,
    private: false,
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as never,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('invalidateGitHubAccessCacheForEvent', () => {
  let context: GithubServiceContext;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepositoryIdsByOwner.mockResolvedValue([]);
    context = createMockContext();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('invalidates the repository access cache for member events', async () => {
    const data = createMemberAddedEvent({ repository: { id: 111, full_name: 'acme/widgets' } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:111');
  });

  it('invalidates for member removed and member edited events', async () => {
    const removed = createMemberRemovedEvent({ repository: { id: 222 } });
    const edited = createMemberEditedEvent({ repository: { id: 333 } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(removed));
    await invalidateGitHubAccessCacheForEvent(context, asPayload(edited));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:222');
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:333');
  });

  it.each([
    ['privatized', () => createRepositoryPrivatizedEvent({ repository: { id: 401 } })],
    ['publicized', () => createRepositoryPublicizedEvent({ repository: { id: 402 } })],
    ['transferred', () => createRepositoryTransferredEvent({ repository: { id: 403 } })],
    ['archived', () => createRepositoryArchivedEvent({ repository: { id: 404 } })],
    ['unarchived', () => createRepositoryUnarchivedEvent({ repository: { id: 405 } })],
    ['deleted', () => createRepositoryDeletedEvent({ repository: { id: 406 } })],
  ] as const)('invalidates the access cache for repository %s events', async (_name, build) => {
    const data = build();

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith(
      `github-access:*:${data.repository.id}`,
    );
  });

  it('invalidates for team added/removed from repository events', async () => {
    // team_add events carry the *full* repository schema (unlike
    // installation_repositories, whose array items use a minimal repository
    // shape) -- reuse a full repository fixture rather than hand-building one.
    const fullRepositorySchema = createRepositoryPrivatizedEvent().repository;
    const added = createTeamAddedToRepositoryEvent({
      repository: { ...fullRepositorySchema, id: 501 },
    });
    const removed = createTeamRemovedFromRepositoryEvent({
      repository: { ...fullRepositorySchema, id: 502 },
    });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(added));
    await invalidateGitHubAccessCacheForEvent(context, asPayload(removed));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:501');
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:502');
  });

  it('does not invalidate a team event whose payload has no repository', async () => {
    const data = createTeamAddedToRepositoryEvent();

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(context.cache.deleteCacheByPattern).not.toHaveBeenCalled();
  });

  it('invalidates for every repository added to the installation', async () => {
    const data = createInstallationRepositoriesAddedEvent({
      repositories_added: [fullRepository(601), fullRepository(602)],
    });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:601');
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:602');
  });

  it('invalidates for every repository removed from the installation', async () => {
    const data = createInstallationRepositoriesRemovedEvent({
      repositories_removed: [fullRepository(701)],
    });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:701');
  });

  it('invalidates for every repository in the organization on organization member events', async () => {
    mockGetRepositoryIdsByOwner.mockResolvedValueOnce([801, 802]);
    const data = createOrganizationMemberAddedEvent({ organization: { login: 'acme' } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(mockGetRepositoryIdsByOwner).toHaveBeenCalledWith(context, 'acme');
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:801');
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:802');
  });

  it('warns when an organization member event affects a large number of repositories', async () => {
    const manyRepositoryIds = Array.from({ length: 101 }, (_, index) => index + 1);
    mockGetRepositoryIdsByOwner.mockResolvedValueOnce(manyRepositoryIds);
    const data = createOrganizationMemberRemovedEvent({ organization: { login: 'acme' } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('large org invalidation for acme'),
    );
  });

  it('caps organization invalidation at 1000 repositories and warns about the cap', async () => {
    const tooManyRepositoryIds = Array.from({ length: 1001 }, (_, index) => index + 1);
    mockGetRepositoryIdsByOwner.mockResolvedValueOnce(tooManyRepositoryIds);
    const data = createOrganizationMemberAddedEvent({ organization: { login: 'acme' } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('capping invalidation at 1000 repos for acme'),
    );
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledTimes(1000);
  });

  it('logs and continues when the organization repository lookup fails', async () => {
    mockGetRepositoryIdsByOwner.mockRejectedValueOnce(new Error('DB down'));
    const data = createOrganizationMemberAddedEvent({ organization: { login: 'acme' } });

    await expect(
      invalidateGitHubAccessCacheForEvent(context, asPayload(data)),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to get repos for org acme:',
      expect.any(Error),
    );
  });

  it('invalidates for every repository in the organization on membership events', async () => {
    mockGetRepositoryIdsByOwner.mockResolvedValueOnce([901]);
    const data = createMembershipAddedEvent({
      organization: { login: 'acme' },
      team: { name: 'core' },
    });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(mockGetRepositoryIdsByOwner).toHaveBeenCalledWith(context, 'acme');
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:901');
  });

  it('warns and caps large membership invalidations the same way as organization events', async () => {
    const manyRepositoryIds = Array.from({ length: 101 }, (_, index) => index + 1);
    mockGetRepositoryIdsByOwner.mockResolvedValueOnce(manyRepositoryIds);
    const data = createMembershipRemovedEvent({
      organization: { login: 'acme' },
      team: { name: 'core' },
    });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('large team invalidation for acme'),
    );
  });

  it('caps membership invalidation at 1000 repositories and warns about the cap', async () => {
    const tooManyRepositoryIds = Array.from({ length: 1001 }, (_, index) => index + 1);
    mockGetRepositoryIdsByOwner.mockResolvedValueOnce(tooManyRepositoryIds);
    const data = createMembershipAddedEvent({
      organization: { login: 'acme' },
      team: { name: 'core' },
    });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('capping invalidation at 1000 repos for acme'),
    );
    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledTimes(1000);
  });

  it('logs and continues when the membership repository lookup fails', async () => {
    mockGetRepositoryIdsByOwner.mockRejectedValueOnce(new Error('DB down'));
    const data = createMembershipAddedEvent({
      organization: { login: 'acme' },
      team: { name: 'core' },
    });

    await expect(
      invalidateGitHubAccessCacheForEvent(context, asPayload(data)),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to get repos for org acme:',
      expect.any(Error),
    );
  });

  it('invalidates the repository access cache for the deprecated public event', async () => {
    const data = createPublicEvent({ repository: { id: 1001 } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(context.cache.deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:1001');
  });

  it('logs and continues when invalidating a specific repository fails', async () => {
    vi.mocked(context.cache.deleteCacheByPattern).mockRejectedValueOnce(new Error('Redis down'));
    const data = createMemberAddedEvent({ repository: { id: 111 } });

    await expect(
      invalidateGitHubAccessCacheForEvent(context, asPayload(data)),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to invalidate GitHub access cache for repository 111:',
      expect.any(Error),
    );
  });

  it('does nothing for events that do not affect repository access', async () => {
    const data: WebhookPayload = { action: 'deployment_completed' };

    await expect(
      invalidateGitHubAccessCacheForEvent(context, asPayload(data)),
    ).resolves.toBeUndefined();

    expect(context.cache.deleteCacheByPattern).not.toHaveBeenCalled();
  });

  it('logs the console.log lines it emits for observability', async () => {
    const data = createMemberAddedEvent({ repository: { id: 111, full_name: 'acme/widgets' } });

    await invalidateGitHubAccessCacheForEvent(context, asPayload(data));

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('member added on acme/widgets'),
    );
  });
});
