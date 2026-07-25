import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireAndForgetInstallationSync } from './installation-sync-dispatch';
import type { WebhookContext } from './types';

const signalInstallationSyncEngineMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/review/engine-client', () => ({
  signalInstallationSyncEngine: signalInstallationSyncEngineMock,
}));

describe('fireAndForgetInstallationSync', () => {
  beforeEach(() => {
    signalInstallationSyncEngineMock.mockReset();
  });

  it('does not log when the enqueue succeeds', async () => {
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'sent',
      ok: true,
      responseStatus: 202,
    });
    const logger = createLogger();

    fireAndForgetInstallationSync({ installationId: 1, reason: 'test' }, logger);
    await flush();

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an error when engine control is not configured', async () => {
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });
    const logger = createLogger();

    fireAndForgetInstallationSync({ installationId: 1, reason: 'test' }, logger);
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      {
        error: expect.any(Error),
        missingSettings: ['TRIBUNAL_ENGINE_URL'],
      },
      'Installation sync engine dispatch is not configured',
    );
  });

  it('logs an error when the engine reports a failed delivery', async () => {
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'sent',
      ok: false,
      responseStatus: 503,
    });
    const logger = createLogger();

    fireAndForgetInstallationSync({ installationId: 1, reason: 'test' }, logger);
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      { responseStatus: 503 },
      'Installation sync engine dispatch failed',
    );
  });

  it('logs an error when the dispatch promise rejects', async () => {
    const rejection = new Error('network error');
    signalInstallationSyncEngineMock.mockRejectedValue(rejection);
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
