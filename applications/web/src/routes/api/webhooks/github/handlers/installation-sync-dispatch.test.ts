import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireAndForgetInstallationSync } from './installation-sync-dispatch';
import type { WebhookContext } from './types';

const enqueueInstallationSyncMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/sync', () => ({
  enqueueInstallationSync: enqueueInstallationSyncMock,
}));

describe('fireAndForgetInstallationSync', () => {
  beforeEach(() => {
    enqueueInstallationSyncMock.mockReset();
  });

  it('does not log when the enqueue succeeds', async () => {
    enqueueInstallationSyncMock.mockResolvedValue({ status: 'enqueued', workflowId: 'sync:1' });
    const logger = createLogger();

    fireAndForgetInstallationSync({ installationId: 1, reason: 'test' }, logger);
    await flush();

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an error when the enqueue resolves with an error status', async () => {
    enqueueInstallationSyncMock.mockResolvedValue({
      status: 'error',
      error: 'boom',
      workflowId: 'sync:1',
    });
    const logger = createLogger();

    fireAndForgetInstallationSync({ installationId: 1, reason: 'test' }, logger);
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      { error: 'boom', workflowId: 'sync:1' },
      'Installation sync enqueue returned an error status',
    );
  });

  it('logs an error when the enqueue promise rejects', async () => {
    const rejection = new Error('network error');
    enqueueInstallationSyncMock.mockRejectedValue(rejection);
    const logger = createLogger();

    fireAndForgetInstallationSync({ installationId: 1, reason: 'test' }, logger);
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      { error: rejection },
      'Failed to enqueue installation sync',
    );
  });
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
