import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubContext } from './github-context';

const mocks = vi.hoisted(() => ({
  cancelInstallationSyncEngine: vi.fn(),
  cancelReviewWorkflowsEngine: vi.fn(),
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
  cancelReviewWorkflowsEngine: mocks.cancelReviewWorkflowsEngine,
  createFailedWorkflowCancellationResult: (workflowIds: string[], error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cancelled: 0,
      failed: workflowIds.length,
      errors: workflowIds.map((workflowId) => `${workflowId}: ${message}`),
    };
  },
  parseWorkflowCancellationResult: (body: unknown) => {
    if (body === null || typeof body !== 'object') return null;
    const candidate = body as {
      cancelled?: unknown;
      failed?: unknown;
      errors?: unknown;
    };
    if (
      Number.isInteger(candidate.cancelled) &&
      Number.isInteger(candidate.failed) &&
      Array.isArray(candidate.errors) &&
      candidate.errors.every((error): error is string => typeof error === 'string')
    ) {
      return {
        cancelled: candidate.cancelled,
        failed: candidate.failed,
        errors: candidate.errors,
      };
    }
    return null;
  },
}));

describe('githubContext', () => {
  beforeEach(() => {
    mocks.cancelInstallationSyncEngine.mockReset();
    mocks.cancelReviewWorkflowsEngine.mockReset();
    mocks.getWeftClient.mockReset();
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

  it('forwards workflow cancellation to the engine owner', async () => {
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'sent',
      ok: true,
      responseStatus: 202,
    });
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(cancelWorkflowsById(['review:pr:42:7'])).resolves.toEqual({
      cancelled: 1,
      failed: 0,
      errors: [],
    });

    expect(mocks.cancelReviewWorkflowsEngine).toHaveBeenCalledWith(['review:pr:42:7']);
  });

  it('reports production workflow cancellation delivery failures', async () => {
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'sent',
      ok: false,
      responseStatus: 503,
    });
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(cancelWorkflowsById(['review:pr:42:7'])).resolves.toEqual({
      cancelled: 0,
      failed: 1,
      errors: ['review:pr:42:7: Review workflow engine cancellation failed with status 503.'],
    });
  });

  it('reports production workflow cancellation request failures', async () => {
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'failed',
      error: new Error('engine offline'),
    });
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(cancelWorkflowsById(['review:pr:42:7'])).resolves.toEqual({
      cancelled: 0,
      failed: 1,
      errors: ['review:pr:42:7: engine offline'],
    });
  });

  it('preserves structured partial workflow cancellation results from the engine', async () => {
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'sent',
      ok: false,
      responseStatus: 502,
      body: {
        ok: false,
        cancelled: 1,
        failed: 1,
        errors: ['review:pr:42:8: storage unavailable'],
      },
    });
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(cancelWorkflowsById(['review:pr:42:7', 'review:pr:42:8'])).resolves.toEqual({
      cancelled: 1,
      failed: 1,
      errors: ['review:pr:42:8: storage unavailable'],
    });
  });

  it('falls back to local cancellation when engine control is absent', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });
    mocks.getWeftClient.mockResolvedValue({ cancel });
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(cancelWorkflowsById(['review:pr:42:7'])).resolves.toEqual({
      cancelled: 1,
      failed: 0,
      errors: [],
    });

    expect(cancel).toHaveBeenCalledWith('review:pr:42:7');
  });

  it('fails closed when engine control and local cancellation are both absent', async () => {
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });
    mocks.getWeftClient.mockRejectedValue(new Error('WEFT_DATABASE_URL is not configured'));
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(cancelWorkflowsById(['review:pr:42:7'])).resolves.toEqual({
      cancelled: 0,
      failed: 1,
      errors: [
        'review:pr:42:7: Review workflow engine control and local cancellation are unavailable.',
      ],
    });
  });

  it('ignores locally missing workflows and reports local cancellation failures', async () => {
    const missingWorkflowError = Object.assign(new Error('not found'), {
      code: 'WorkflowNotFoundError',
    });
    const cancel = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(missingWorkflowError)
      .mockRejectedValueOnce(new Error('database unavailable'));
    mocks.cancelReviewWorkflowsEngine.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });
    mocks.getWeftClient.mockResolvedValue({ cancel });
    const cancelWorkflowsById = getCancelWorkflowsById();

    await expect(
      cancelWorkflowsById(['review:pr:42:7', 'review:pr:42:8', 'review:pr:42:9']),
    ).resolves.toEqual({
      cancelled: 1,
      failed: 1,
      errors: ['review:pr:42:9: database unavailable'],
    });
  });
});

function getCancelInstallationSync() {
  const { cancelInstallationSync } = githubContext;
  if (!cancelInstallationSync) {
    throw new Error('Expected githubContext.cancelInstallationSync to be configured.');
  }
  return cancelInstallationSync;
}

function getCancelWorkflowsById() {
  const { cancelWorkflowsById } = githubContext;
  if (!cancelWorkflowsById) {
    throw new Error('Expected githubContext.cancelWorkflowsById to be configured.');
  }
  return cancelWorkflowsById;
}
