import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InstallationRepositoriesEvent } from '@octokit/webhooks-types';
import { handleInstallationRepositories } from './installation-repositories-lifecycle.server';
import type { WebhookContext } from './types';

const handleRepositoriesRemovedMock = vi.hoisted(() => vi.fn());
const getPrimaryWorkspaceIdForInstallationMock = vi.hoisted(() => vi.fn());
const fireAndForgetInstallationSyncMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/installations/lifecycle', () => ({
  handleRepositoriesRemoved: handleRepositoriesRemovedMock,
}));

vi.mock('$lib/server/github/webhooks/handlers', () => ({
  getPrimaryWorkspaceIdForInstallation: getPrimaryWorkspaceIdForInstallationMock,
}));

vi.mock('./installation-sync-dispatch', () => ({
  fireAndForgetInstallationSync: fireAndForgetInstallationSyncMock,
}));

describe('handleInstallationRepositories', () => {
  beforeEach(() => {
    handleRepositoriesRemovedMock.mockReset().mockResolvedValue(undefined);
    getPrimaryWorkspaceIdForInstallationMock.mockReset().mockResolvedValue(7);
    fireAndForgetInstallationSyncMock.mockReset();
  });

  it('triggers a sync on added', async () => {
    const context = createContext();
    await handleInstallationRepositories(createPayload('added'), context);

    expect(fireAndForgetInstallationSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 100,
        workspaceId: 7,
        reason: 'webhook:installation_repositories.added',
      }),
      context.logger,
    );
    expect(context.logger.info).toHaveBeenCalledWith(expect.stringContaining('triggering sync'));
  });

  it('warns but still triggers sync on added when workspace resolution fails', async () => {
    getPrimaryWorkspaceIdForInstallationMock.mockRejectedValue(new Error('lookup failed'));
    const context = createContext();

    await handleInstallationRepositories(createPayload('added'), context);

    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('Failed to resolve workspace'),
    );
    expect(fireAndForgetInstallationSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: undefined }),
      context.logger,
    );
  });

  it('cancels workflows for removed repositories and triggers sync on removed', async () => {
    const context = createContext();
    await handleInstallationRepositories(createPayload('removed'), context);

    expect(handleRepositoriesRemovedMock).toHaveBeenCalledWith(expect.anything(), 100, [1, 2]);
    expect(fireAndForgetInstallationSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'webhook:installation_repositories.removed' }),
      context.logger,
    );
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('cancelling workflows'),
    );
  });

  it('warns but still triggers sync on removed when workspace resolution fails', async () => {
    getPrimaryWorkspaceIdForInstallationMock.mockRejectedValue(new Error('lookup failed'));
    const context = createContext();

    await handleInstallationRepositories(createPayload('removed'), context);

    expect(handleRepositoriesRemovedMock).toHaveBeenCalled();
    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('Failed to resolve workspace'),
    );
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    await handleInstallationRepositories(createPayload('some-other-action'), context);

    expect(fireAndForgetInstallationSyncMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'some-other-action' }),
      expect.stringContaining('Unhandled'),
    );
  });
});

function createPayload(action: string): InstallationRepositoriesEvent {
  return {
    action,
    repositories_removed: [{ id: 1 }, { id: 2 }],
  } as unknown as InstallationRepositoriesEvent;
}

function createContext(): WebhookContext {
  return {
    deliveryId: 'delivery-1',
    installationId: 100,
    repositoryId: 42,
    logger: createLogger(),
    origin: 'https://tribunal.dev',
  };
}

function createLogger(): WebhookContext['logger'] {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createLogger()),
  };
}
