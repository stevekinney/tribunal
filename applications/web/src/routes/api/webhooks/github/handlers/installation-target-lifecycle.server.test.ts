import { describe, expect, it, vi } from 'vitest';
import type { InstallationTargetEvent } from '@octokit/webhooks-types';
import { handleInstallationTarget } from './installation-target-lifecycle.server';
import type { WebhookContext } from './types';

describe('handleInstallationTarget', () => {
  it('logs the rename for installation_target.renamed', async () => {
    const context = createContext();
    const payload = {
      action: 'renamed',
      changes: { login: { from: 'old-org' } },
      account: { login: 'new-org' },
    } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

    expect(context.logger.info).toHaveBeenCalledWith(expect.stringContaining('old-org to new-org'));
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    const payload = { action: 'some-other-action' } as unknown as InstallationTargetEvent;

    await handleInstallationTarget(payload, context);

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
