import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestEvent } from '@octokit/webhooks-types';
import { handlePullRequestEvent } from './pull-request.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());
const signalPullRequestClosedMock = vi.hoisted(() => vi.fn());
const kickReviewEngineAfterDurableIntentMock = vi.hoisted(() => vi.fn());

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
  signalPullRequestClosed: signalPullRequestClosedMock,
}));

vi.mock('./review-engine-kick.server', () => ({
  kickReviewEngineAfterDurableIntent: kickReviewEngineAfterDurableIntentMock,
}));

describe('handlePullRequestEvent', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset().mockResolvedValue({
      ok: true,
      workflowId: 'review:pr:42:7',
      enqueued: true,
      enqueueStatus: 'enqueued',
      intentKind: 'start',
    });
    signalPullRequestClosedMock.mockReset().mockResolvedValue({
      ok: true,
      workflowId: 'review:pr:42:7',
      enqueued: true,
      enqueueStatus: 'enqueued',
      intentKind: 'pr_closed',
    });
    kickReviewEngineAfterDurableIntentMock.mockReset().mockResolvedValue(undefined);
  });

  it('enqueues a review intent for a non-draft opened pull request', async () => {
    await handlePullRequestEvent(createPayload('opened', { draft: false }), createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledTimes(1);
    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'pr_opened' }),
    );
    expect(kickReviewEngineAfterDurableIntentMock).toHaveBeenCalledTimes(1);
  });

  it('skips a draft pull request on opened without enqueuing anything', async () => {
    const context = createContext();
    await handlePullRequestEvent(createPayload('opened', { draft: true }), context);

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(kickReviewEngineAfterDurableIntentMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opened' }),
      expect.stringContaining('draft'),
    );
  });

  it('skips a draft pull request on synchronize', async () => {
    await handlePullRequestEvent(createPayload('synchronize', { draft: true }), createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('skips a draft pull request on reopened', async () => {
    await handlePullRequestEvent(createPayload('reopened', { draft: true }), createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('always enqueues on ready_for_review regardless of the draft flag', async () => {
    await handlePullRequestEvent(
      createPayload('ready_for_review', { draft: false }),
      createContext(),
    );

    expect(signalPullRequestEventMock).toHaveBeenCalledTimes(1);
    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'pr_ready_for_review' }),
    );
  });

  it('enqueues a closed intent regardless of draft state', async () => {
    await handlePullRequestEvent(createPayload('closed', { draft: true }), createContext());

    expect(signalPullRequestClosedMock).toHaveBeenCalledTimes(1);
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    await handlePullRequestEvent(createPayload('labeled'), context);

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(signalPullRequestClosedMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'labeled' }),
      expect.stringContaining('Unhandled'),
    );
  });

  it('logs and throws when the opened/reopened/synchronize enqueue fails', async () => {
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
      intentKind: 'start',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handlePullRequestEvent(createPayload('opened', { draft: false }), createContext()),
    ).rejects.toThrow(/Failed to enqueue PR opened intent/);

    expect(errorSpy).toHaveBeenCalledWith(
      '[webhook] Failed to enqueue pull request review intent:',
      expect.objectContaining({ event: 'pull_request', action: 'opened' }),
    );
  });

  it('includes hookId in the failure log when present', async () => {
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
      intentKind: 'start',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = createContext();
    context.hookId = 'hook-123';

    await expect(
      handlePullRequestEvent(createPayload('opened', { draft: false }), context),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      '[webhook] Failed to enqueue pull request review intent:',
      expect.objectContaining({ hookId: 'hook-123' }),
    );
  });

  it('logs and throws when the ready_for_review enqueue fails', async () => {
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
      intentKind: 'start',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handlePullRequestEvent(createPayload('ready_for_review', { draft: false }), createContext()),
    ).rejects.toThrow(/Failed to enqueue PR ready_for_review intent/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs and throws when the closed enqueue fails', async () => {
    signalPullRequestClosedMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handlePullRequestEvent(createPayload('closed', { draft: false }), createContext()),
    ).rejects.toThrow(/Failed to enqueue PR closed intent/);
    expect(errorSpy).toHaveBeenCalledWith(
      '[webhook] Failed to enqueue PR closed review intent:',
      expect.objectContaining({ event: 'pull_request' }),
    );
  });
});

function createPayload(action: string, overrides: { draft?: boolean } = {}): PullRequestEvent {
  return {
    action,
    pull_request: {
      number: 7,
      head: { sha: 'abc123' },
      merged: false,
      draft: overrides.draft ?? false,
    },
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: { login: 'steve' },
  } as unknown as PullRequestEvent;
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
