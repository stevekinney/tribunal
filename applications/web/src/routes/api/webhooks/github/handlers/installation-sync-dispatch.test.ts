import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dispatchInstallationSync } from './installation-sync-dispatch';
import type { WebhookContext } from './types';

const signalInstallationSyncEngineMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/review/engine-client', () => ({
  signalInstallationSyncEngine: signalInstallationSyncEngineMock,
}));

describe('dispatchInstallationSync', () => {
  beforeEach(() => {
    signalInstallationSyncEngineMock.mockReset();
  });

  it('does not log when the dispatch succeeds', async () => {
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'sent',
      ok: true,
      responseStatus: 202,
    });
    const logger = createLogger();

    await dispatchInstallationSync({ installationId: 1, reason: 'test' }, logger);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('throws and logs when engine control is not configured', async () => {
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });
    const logger = createLogger();

    await expect(
      dispatchInstallationSync({ installationId: 1, reason: 'test' }, logger),
    ).rejects.toThrow('Installation sync engine control is not configured');

    expect(logger.error).toHaveBeenCalledWith(
      {
        error: expect.any(Error),
        missingSettings: ['TRIBUNAL_ENGINE_URL'],
      },
      'Installation sync engine dispatch is not configured',
    );
  });

  it('throws and logs when the engine reports a failed delivery', async () => {
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'sent',
      ok: false,
      responseStatus: 503,
    });
    const logger = createLogger();

    await expect(
      dispatchInstallationSync({ installationId: 1, reason: 'test' }, logger),
    ).rejects.toThrow('Installation sync engine dispatch failed with status 503');

    expect(logger.error).toHaveBeenCalledWith(
      { responseStatus: 503 },
      'Installation sync engine dispatch failed',
    );
  });

  it('throws and logs when the engine client returns a structured failure', async () => {
    const error = new Error('engine unavailable');
    signalInstallationSyncEngineMock.mockResolvedValue({
      status: 'failed',
      error,
    });
    const logger = createLogger();

    await expect(
      dispatchInstallationSync({ installationId: 1, reason: 'test' }, logger),
    ).rejects.toThrow('engine unavailable');

    expect(logger.error).toHaveBeenCalledWith(
      { error },
      'Installation sync engine dispatch failed',
    );
  });

  it('throws and logs when the dispatch promise rejects', async () => {
    const rejection = new Error('network error');
    signalInstallationSyncEngineMock.mockRejectedValue(rejection);
    const logger = createLogger();

    await expect(
      dispatchInstallationSync({ installationId: 1, reason: 'test' }, logger),
    ).rejects.toThrow('network error');

    expect(logger.error).toHaveBeenCalledWith(
      { error: rejection },
      'Installation sync engine dispatch failed',
    );
  });
});

function createLogger(): WebhookContext['logger'] {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createLogger()),
  };
}
