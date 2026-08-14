import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallationTargetEvent } from '@octokit/webhooks-types';
import { handleInstallationTarget } from './installation-target-lifecycle.server';
import type { WebhookContext } from './types';

const updateInstallationAccountMetadataMock = vi.hoisted(() => vi.fn());
const upsertInstallationMock = vi.hoisted(() => vi.fn());
const updateInstallationRepositoryOwnerMetadataMock = vi.hoisted(() => vi.fn());
const getInstallationOctokitMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({
  githubContext: { getInstallationOctokit: getInstallationOctokitMock },
}));

vi.mock('@tribunal/github/installations/records', () => ({
  updateInstallationAccountMetadata: updateInstallationAccountMetadataMock,
  upsertInstallation: upsertInstallationMock,
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  updateInstallationRepositoryOwnerMetadata: updateInstallationRepositoryOwnerMetadataMock,
}));

describe('handleInstallationTarget', () => {
  beforeEach(() => {
    updateInstallationAccountMetadataMock.mockReset().mockResolvedValue({ updated: true });
    upsertInstallationMock.mockReset().mockResolvedValue(undefined);
    updateInstallationRepositoryOwnerMetadataMock.mockReset().mockResolvedValue({ updated: 0 });
    getInstallationOctokitMock.mockReset().mockResolvedValue({});
  });

  it('updates installation account metadata for installation_target.renamed', async () => {
    const context = createContext();
    const payload = {
      action: 'renamed',
      changes: { login: { from: 'old-org' } },
      account: {
        id: 123,
        login: 'new-org',
        type: 'Organization',
        avatar_url: 'https://avatars.example/new-org',
      },
    } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

    expect(updateInstallationAccountMetadataMock).toHaveBeenCalledWith(expect.anything(), {
      installationId: 100,
      accountId: 123,
      accountLogin: 'new-org',
      accountAvatarUrl: 'https://avatars.example/new-org',
    });
    expect(updateInstallationRepositoryOwnerMetadataMock).toHaveBeenCalledWith(
      expect.anything(),
      100,
      'old-org',
      'new-org',
    );
    expect(context.logger.info).toHaveBeenCalledWith(expect.stringContaining('old-org to new-org'));
  });

  it('does not recreate an installation that no longer exists on GitHub', async () => {
    updateInstallationAccountMetadataMock.mockResolvedValue({ updated: false });
    getInstallationOctokitMock.mockResolvedValue(null);
    const context = createContext();
    const payload = {
      action: 'renamed',
      installation: { id: 100, repository_selection: 'selected' },
      changes: { login: { from: 'old-org' } },
      account: { id: 123, login: 'new-org', type: 'Organization', avatar_url: null },
    } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 100 }),
      expect.stringContaining('deleted'),
    );
    expect(upsertInstallationMock).not.toHaveBeenCalled();
    expect(updateInstallationRepositoryOwnerMetadataMock).not.toHaveBeenCalled();
  });

  it('creates an unbound installation row when the rename arrives before installation creation', async () => {
    updateInstallationAccountMetadataMock.mockResolvedValue({ updated: false });
    const context = createContext();
    const payload = {
      action: 'renamed',
      installation: {
        id: 100,
        repository_selection: 'selected',
      },
      changes: { login: { from: 'old-org' } },
      account: {
        id: 123,
        login: 'new-org',
        type: 'Organization',
        avatar_url: null,
      },
    } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

    expect(upsertInstallationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        installationId: 100,
        accountLogin: 'new-org',
        accountId: 123,
        accountAvatarUrl: null,
      }),
    );
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    const payload = { action: 'some-other-action' } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

    expect(updateInstallationAccountMetadataMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'some-other-action' }),
      expect.stringContaining('Unhandled'),
    );
  });
});

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
