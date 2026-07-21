import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InstallationEvent } from '@octokit/webhooks-types';
import { handleInstallation } from './installation-lifecycle.server';
import type { WebhookContext } from './types';

const handleInstallationDeletedMock = vi.hoisted(() => vi.fn());
const handleInstallationSuspendMock = vi.hoisted(() => vi.fn());
const handleInstallationUnsuspendMock = vi.hoisted(() => vi.fn());
const upsertInstallationMock = vi.hoisted(() => vi.fn());
const updateInstallationStatusMock = vi.hoisted(() => vi.fn());
const getPrimaryWorkspaceIdForInstallationMock = vi.hoisted(() => vi.fn());
const fireAndForgetInstallationSyncMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/installations/records', () => ({
  upsertInstallation: upsertInstallationMock,
  updateInstallationStatus: updateInstallationStatusMock,
}));

vi.mock('@tribunal/github/installations/lifecycle', () => ({
  handleInstallationDeleted: handleInstallationDeletedMock,
  handleInstallationSuspend: handleInstallationSuspendMock,
  handleInstallationUnsuspend: handleInstallationUnsuspendMock,
}));

vi.mock('$lib/server/github/webhooks/handlers', () => ({
  getPrimaryWorkspaceIdForInstallation: getPrimaryWorkspaceIdForInstallationMock,
}));

vi.mock('./installation-sync-dispatch', () => ({
  fireAndForgetInstallationSync: fireAndForgetInstallationSyncMock,
}));

describe('handleInstallation', () => {
  beforeEach(() => {
    handleInstallationDeletedMock.mockReset().mockResolvedValue(undefined);
    handleInstallationSuspendMock.mockReset().mockResolvedValue(undefined);
    handleInstallationUnsuspendMock.mockReset().mockResolvedValue(undefined);
    upsertInstallationMock.mockReset().mockResolvedValue(undefined);
    updateInstallationStatusMock.mockReset().mockResolvedValue(undefined);
    getPrimaryWorkspaceIdForInstallationMock.mockReset().mockResolvedValue(7);
    fireAndForgetInstallationSyncMock.mockReset();
  });

  it('handles deleted', async () => {
    const context = createContext();
    await handleInstallation(createPayload('deleted'), context);

    expect(handleInstallationDeletedMock).toHaveBeenCalledWith(expect.anything(), 100);
    expect(context.logger.info).toHaveBeenCalledWith('Installation deleted');
  });

  it('handles suspend', async () => {
    const context = createContext();
    await handleInstallation(createPayload('suspend'), context);

    expect(handleInstallationSuspendMock).toHaveBeenCalledWith(
      expect.anything(),
      100,
      'Suspended by GitHub',
    );
    expect(context.logger.info).toHaveBeenCalledWith('Installation suspended');
  });

  it('handles unsuspend', async () => {
    const context = createContext();
    await handleInstallation(createPayload('unsuspend'), context);

    expect(handleInstallationUnsuspendMock).toHaveBeenCalledWith(expect.anything(), 100);
    expect(context.logger.info).toHaveBeenCalledWith('Installation unsuspended');
  });

  it('creates a stub installation and triggers sync on created with an account', async () => {
    const context = createContext();
    await handleInstallation(createPayload('created', { withAccount: true }), context);

    expect(upsertInstallationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ installationId: 100, accountLogin: 'acme' }),
    );
    expect(fireAndForgetInstallationSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 100, reason: 'webhook:installation.created' }),
      context.logger,
    );
  });

  it('logs without upserting on created when no account info is available', async () => {
    const context = createContext();
    await handleInstallation(createPayload('created', { withAccount: false }), context);

    expect(upsertInstallationMock).not.toHaveBeenCalled();
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no account info available'),
    );
  });

  it('updates status and triggers sync on new_permissions_accepted', async () => {
    const context = createContext();
    await handleInstallation(createPayload('new_permissions_accepted'), context);

    expect(updateInstallationStatusMock).toHaveBeenCalledWith(expect.anything(), 100, 'active');
    expect(fireAndForgetInstallationSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 100,
        reason: 'webhook:installation.new_permissions_accepted',
      }),
      context.logger,
    );
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    await handleInstallation(createPayload('some-other-action'), context);

    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'some-other-action' }),
      expect.stringContaining('Unhandled'),
    );
  });
});

function createPayload(action: string, options: { withAccount?: boolean } = {}): InstallationEvent {
  return {
    action,
    installation: {
      account: options.withAccount
        ? { login: 'acme', type: 'Organization', id: 555, avatar_url: 'https://x/avatar.png' }
        : null,
      repository_selection: 'selected',
    },
  } as unknown as InstallationEvent;
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
