import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubContext } from './github-context';

const mocks = vi.hoisted(() => ({
  cancelInstallationSyncEngine: vi.fn(),
  db: {},
  getCached: vi.fn(),
  setCache: vi.fn(),
  setCacheIndefinitely: vi.fn(),
  deleteCache: vi.fn(),
  deleteCacheByPattern: vi.fn(),
  resetCacheClient: vi.fn(),
  getInstallationOctokit: vi.fn(),
  getGithubApplication: vi.fn(),
  getWeftClient: vi.fn(),
}));

vi.mock('$lib/server/database', () => ({
  db: mocks.db,
}));

vi.mock('$lib/server/redis', () => ({
  getCached: mocks.getCached,
  setCache: mocks.setCache,
  setCacheIndefinitely: mocks.setCacheIndefinitely,
  deleteCache: mocks.deleteCache,
  deleteCacheByPattern: mocks.deleteCacheByPattern,
  resetCacheClient: mocks.resetCacheClient,
}));

vi.mock('$lib/server/github/github-application', () => ({
  getInstallationOctokit: mocks.getInstallationOctokit,
  getGithubApplication: mocks.getGithubApplication,
}));

vi.mock('$lib/server/weft/engine', () => ({
  getWeftClient: mocks.getWeftClient,
}));

vi.mock('$lib/server/review/engine-client', () => ({
  cancelInstallationSyncEngine: mocks.cancelInstallationSyncEngine,
}));

describe('githubContext', () => {
  beforeEach(() => {
    mocks.cancelInstallationSyncEngine.mockReset();
  });

  it('forwards installation sync cancellation to the engine owner', async () => {
    mocks.cancelInstallationSyncEngine.mockResolvedValue({
      status: 'sent',
      ok: true,
      responseStatus: 202,
    });
    const cancelInstallationSync = getCancelInstallationSync();

    await expect(cancelInstallationSync(123)).resolves.toBeUndefined();

    expect(mocks.cancelInstallationSyncEngine).toHaveBeenCalledWith(123);
  });

  it('treats absent engine control as nothing to cancel', async () => {
    mocks.cancelInstallationSyncEngine.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });
    const cancelInstallationSync = getCancelInstallationSync();

    await expect(cancelInstallationSync(123)).resolves.toBeUndefined();
  });

  it('rejects cancellation when the engine client returns a structured failure', async () => {
    const error = new Error('engine unavailable');
    mocks.cancelInstallationSyncEngine.mockResolvedValue({
      status: 'failed',
      error,
    });
    const cancelInstallationSync = getCancelInstallationSync();

    await expect(cancelInstallationSync(123)).rejects.toThrow('engine unavailable');
  });

  it('rejects cancellation when the engine returns a non-success response', async () => {
    mocks.cancelInstallationSyncEngine.mockResolvedValue({
      status: 'sent',
      ok: false,
      responseStatus: 503,
    });
    const cancelInstallationSync = getCancelInstallationSync();

    await expect(cancelInstallationSync(123)).rejects.toThrow(
      'Installation sync engine cancellation failed with status 503',
    );
  });
});

function getCancelInstallationSync() {
  const { cancelInstallationSync } = githubContext;
  if (!cancelInstallationSync) {
    throw new Error('Expected githubContext.cancelInstallationSync to be configured.');
  }
  return cancelInstallationSync;
}
