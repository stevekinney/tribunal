import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPullRequestOpenedEvent,
  createPullRequestReviewSubmittedEvent,
  createPullRequestReviewDismissedEvent,
  createCheckSuiteCompletedEvent,
  createPushEvent,
} from 'github-webhook-schemas/fixtures';
import type { GithubServiceContext } from '../context.js';
import type { PushEvent } from './validate-github-webhook.js';

const mockHandlePullRequestStateUpdate = vi.fn().mockResolvedValue(undefined);
const mockHandleReviewStateUpdate = vi.fn().mockResolvedValue(undefined);
const mockHandleCheckSuiteCompleted = vi.fn().mockResolvedValue(undefined);
const mockHandleBaseBranchPush = vi
  .fn()
  .mockResolvedValue({ updated: 0, errors: 0, affectedPrNumbers: [] });

vi.mock('../pull-requests/state/index.js', () => ({
  handlePullRequestStateUpdate: (...args: unknown[]) => mockHandlePullRequestStateUpdate(...args),
  handleReviewStateUpdate: (...args: unknown[]) => mockHandleReviewStateUpdate(...args),
  handleCheckSuiteCompleted: (...args: unknown[]) => mockHandleCheckSuiteCompleted(...args),
  handleBaseBranchPush: (...args: unknown[]) => mockHandleBaseBranchPush(...args),
}));

const mockGetRepositoryById = vi.fn();
const mockUpdateRepositoryCommit = vi.fn().mockResolvedValue(undefined);

vi.mock('../repositories/service.js', () => ({
  getRepositoryById: (...args: unknown[]) => mockGetRepositoryById(...args),
  updateRepositoryCommit: (...args: unknown[]) => mockUpdateRepositoryCommit(...args),
}));

const { dispatchPRStateTracking, dispatchBaseBranchUpdate } =
  await import('./pr-state-dispatch.js');

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as never,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('dispatchPRStateTracking', () => {
  let context: GithubServiceContext;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches pull_request state updates fire-and-forget', async () => {
    const data = createPullRequestOpenedEvent({ pull_request: { number: 42 } });

    dispatchPRStateTracking(context, 'pull_request', 'opened', data as never);
    await vi.waitFor(() => expect(mockHandlePullRequestStateUpdate).toHaveBeenCalled());

    expect(mockHandlePullRequestStateUpdate).toHaveBeenCalledWith(context, data, 'opened');
  });

  it('logs and swallows a pull_request handler failure', async () => {
    mockHandlePullRequestStateUpdate.mockRejectedValueOnce(new Error('boom'));
    const data = createPullRequestOpenedEvent({ pull_request: { number: 42 } });

    dispatchPRStateTracking(context, 'pull_request', 'opened', data as never);
    await vi.waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PR state: pull_request handler failed:',
        expect.any(Error),
      ),
    );
  });

  it('does not dispatch for a payload with no matching pull_request/review/check_suite shape', () => {
    dispatchPRStateTracking(context, 'issues', 'opened', { action: 'opened' } as never);

    expect(mockHandlePullRequestStateUpdate).not.toHaveBeenCalled();
    expect(mockHandleReviewStateUpdate).not.toHaveBeenCalled();
    expect(mockHandleCheckSuiteCompleted).not.toHaveBeenCalled();
  });

  it('dispatches a review state update when an installation octokit is available', async () => {
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    const data = createPullRequestReviewSubmittedEvent({
      installation: { id: 999, node_id: 'MDIz' },
    });

    dispatchPRStateTracking(context, 'pull_request_review', 'submitted', data as never);
    await vi.waitFor(() => expect(mockHandleReviewStateUpdate).toHaveBeenCalled());

    expect(context.getInstallationOctokit).toHaveBeenCalledWith(999);
    expect(mockHandleReviewStateUpdate).toHaveBeenCalledWith(context, data, octokit);
  });

  it('handles dismissed reviews the same way as submitted ones', async () => {
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    const data = createPullRequestReviewDismissedEvent({
      installation: { id: 999, node_id: 'MDIz' },
    });

    dispatchPRStateTracking(context, 'pull_request_review', 'dismissed', data as never);
    await vi.waitFor(() => expect(mockHandleReviewStateUpdate).toHaveBeenCalled());
  });

  it('does not fetch an octokit or dispatch a review update when the installation id is missing', async () => {
    const data = createPullRequestReviewSubmittedEvent({ installation: undefined });

    dispatchPRStateTracking(context, 'pull_request_review', 'submitted', data as never);
    await Promise.resolve();

    expect(context.getInstallationOctokit).not.toHaveBeenCalled();
    expect(mockHandleReviewStateUpdate).not.toHaveBeenCalled();
  });

  it('does not dispatch a review update when no installation octokit resolves', async () => {
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(null) });
    const data = createPullRequestReviewSubmittedEvent({
      installation: { id: 999, node_id: 'MDIz' },
    });

    dispatchPRStateTracking(context, 'pull_request_review', 'submitted', data as never);
    await vi.waitFor(() => expect(context.getInstallationOctokit).toHaveBeenCalled());
    await Promise.resolve();

    expect(mockHandleReviewStateUpdate).not.toHaveBeenCalled();
  });

  it('logs and swallows a review handler failure', async () => {
    mockHandleReviewStateUpdate.mockRejectedValueOnce(new Error('boom'));
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    const data = createPullRequestReviewSubmittedEvent({
      installation: { id: 999, node_id: 'MDIz' },
    });

    dispatchPRStateTracking(context, 'pull_request_review', 'submitted', data as never);
    await vi.waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PR state: review handler failed:',
        expect.any(Error),
      ),
    );
  });

  it('dispatches a check_suite completed update when an installation octokit is available', async () => {
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    const data = createCheckSuiteCompletedEvent({ installation: { id: 999, node_id: 'MDIz' } });

    dispatchPRStateTracking(context, 'check_suite', 'completed', data as never);
    await vi.waitFor(() => expect(mockHandleCheckSuiteCompleted).toHaveBeenCalled());

    expect(context.getInstallationOctokit).toHaveBeenCalledWith(999);
    expect(mockHandleCheckSuiteCompleted).toHaveBeenCalledWith(context, data, octokit);
  });

  it('does not fetch an octokit for a check_suite event with no installation id', async () => {
    const data = createCheckSuiteCompletedEvent({ installation: undefined });

    dispatchPRStateTracking(context, 'check_suite', 'completed', data as never);
    await Promise.resolve();

    expect(context.getInstallationOctokit).not.toHaveBeenCalled();
    expect(mockHandleCheckSuiteCompleted).not.toHaveBeenCalled();
  });

  it('does not dispatch a check_suite update when no installation octokit resolves', async () => {
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(null) });
    const data = createCheckSuiteCompletedEvent({ installation: { id: 999, node_id: 'MDIz' } });

    dispatchPRStateTracking(context, 'check_suite', 'completed', data as never);
    await vi.waitFor(() => expect(context.getInstallationOctokit).toHaveBeenCalled());
    await Promise.resolve();

    expect(mockHandleCheckSuiteCompleted).not.toHaveBeenCalled();
  });

  it('logs and swallows a check_suite handler failure', async () => {
    mockHandleCheckSuiteCompleted.mockRejectedValueOnce(new Error('boom'));
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    const data = createCheckSuiteCompletedEvent({ installation: { id: 999, node_id: 'MDIz' } });

    dispatchPRStateTracking(context, 'check_suite', 'completed', data as never);
    await vi.waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PR state: check_suite handler failed:',
        expect.any(Error),
      ),
    );
  });
});

describe('dispatchBaseBranchUpdate', () => {
  let context: GithubServiceContext;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function pushEvent(overrides: Record<string, unknown> = {}): PushEvent {
    return createPushEvent({
      ref: 'refs/heads/main',
      after: 'newsha1234567',
      repository: {
        id: 7001,
        full_name: 'acme/widgets',
        owner: { login: 'acme' },
        name: 'widgets',
      },
      installation: { id: 999, node_id: 'MDIz' },
      ...overrides,
    }) as unknown as PushEvent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHandleBaseBranchPush.mockResolvedValue({ updated: 0, errors: 0, affectedPrNumbers: [] });
  });

  it('does nothing when the repository is not tracked', async () => {
    mockGetRepositoryById.mockResolvedValueOnce(null);

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(context.getInstallationOctokit).not.toHaveBeenCalled();
    expect(mockHandleBaseBranchPush).not.toHaveBeenCalled();
  });

  it('does nothing when the repository has no default branch set', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: null });

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(context.getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('does nothing when the push payload has no installation', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });

    await dispatchBaseBranchUpdate(context, pushEvent({ installation: undefined }));

    expect(mockUpdateRepositoryCommit).not.toHaveBeenCalled();
    expect(context.getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('updates the stored commit SHA when pushing to the default branch', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(null) });

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(mockUpdateRepositoryCommit).toHaveBeenCalledWith(context, 7001, 'newsha1234567');
  });

  it('does not update the commit SHA when pushing to a non-default branch', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(null) });

    await dispatchBaseBranchUpdate(context, pushEvent({ ref: 'refs/heads/feature' }));

    expect(mockUpdateRepositoryCommit).not.toHaveBeenCalled();
  });

  it('logs and continues when updating the commit SHA fails', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    mockUpdateRepositoryCommit.mockRejectedValueOnce(new Error('db down'));
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(null) });

    await expect(dispatchBaseBranchUpdate(context, pushEvent())).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[base-branch-update] Failed to update repository commit:',
      expect.any(Error),
    );
  });

  it('does not call handleBaseBranchPush when no installation octokit resolves', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(null) });

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(mockHandleBaseBranchPush).not.toHaveBeenCalled();
  });

  it('calls handleBaseBranchPush with the resolved octokit', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(mockHandleBaseBranchPush).toHaveBeenCalledWith(
      context,
      { repositoryId: 7001, ref: 'refs/heads/main', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );
  });

  it('falls back to owner.name when owner.login is absent (a differently-shaped push payload)', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    // Deliberately not built from the fixture: it always fills `owner.login`
    // with (at minimum) an empty string, which can never trigger this `??`
    // fallback. This exercises the fallback for a payload shape where
    // `owner.login` is genuinely absent.
    const data = {
      ref: 'refs/heads/main',
      after: 'newsha1234567',
      repository: { id: 7001, owner: { name: 'acme' }, name: 'widgets' },
      installation: { id: 999 },
    } as unknown as PushEvent;

    await dispatchBaseBranchUpdate(context, data);

    expect(mockHandleBaseBranchPush).toHaveBeenCalledWith(
      context,
      { repositoryId: 7001, ref: 'refs/heads/main', defaultBranch: 'main' },
      octokit,
      'acme',
      'widgets',
    );
  });

  it('logs affected PR numbers when the base branch push affects open PRs', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });
    mockHandleBaseBranchPush.mockResolvedValueOnce({
      updated: 1,
      errors: 0,
      affectedPrNumbers: [42],
    });

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(consoleLogSpy).toHaveBeenCalledWith('[base-branch-update] would signal orchestrators', {
      repositoryId: 7001,
      prNumbers: [42],
    });
  });

  it('does not log when the base branch push affects no open PRs', async () => {
    mockGetRepositoryById.mockResolvedValueOnce({ defaultBranch: 'main' });
    const octokit = { rest: {} } as never;
    context = createMockContext({ getInstallationOctokit: vi.fn().mockResolvedValue(octokit) });

    await dispatchBaseBranchUpdate(context, pushEvent());

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      '[base-branch-update] would signal orchestrators',
      expect.anything(),
    );
  });
});
