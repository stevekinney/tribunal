import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallationTargetEvent } from '@octokit/webhooks-types';
import { handleInstallationTarget } from './installation-target-lifecycle.server';
import type { WebhookContext } from './types';

const updateInstallationAccountMetadataMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/installations/records', () => ({
  updateInstallationAccountMetadata: updateInstallationAccountMetadataMock,
}));

describe('handleInstallationTarget', () => {
  beforeEach(() => {
    updateInstallationAccountMetadataMock.mockReset().mockResolvedValue({ updated: true });
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
      accountType: 'Organization',
      accountAvatarUrl: 'https://avatars.example/new-org',
    });
    expect(context.logger.info).toHaveBeenCalledWith(expect.stringContaining('old-org to new-org'));
  });

  it('logs when the installation row is missing', async () => {
    updateInstallationAccountMetadataMock.mockResolvedValue({ updated: false });
    const context = createContext();
    const payload = {
      action: 'renamed',
      changes: { login: { from: 'old-org' } },
      account: {
        id: 123,
        login: 'new-org',
        type: 'Organization',
        avatar_url: null,
      },
    } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 100 }),
      expect.stringContaining('not found'),
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
