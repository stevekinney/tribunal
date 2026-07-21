import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PushEvent } from '@octokit/webhooks-types';
import { handlePush } from './push-lifecycle.server';
import type { WebhookContext } from './types';

const dispatchBaseBranchUpdateMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/webhooks/pr-state-dispatch', () => ({
  dispatchBaseBranchUpdate: dispatchBaseBranchUpdateMock,
}));

describe('handlePush', () => {
  beforeEach(() => {
    dispatchBaseBranchUpdateMock.mockReset();
  });

  it('dispatches a base branch update and logs, without awaiting it', async () => {
    dispatchBaseBranchUpdateMock.mockResolvedValue(undefined);
    const context = createContext();
    const payload = { ref: 'refs/heads/main' } as unknown as PushEvent;

    await handlePush(payload, context);

    expect(dispatchBaseBranchUpdateMock).toHaveBeenCalledWith(expect.anything(), payload);
    expect(context.logger.debug).toHaveBeenCalledWith('Push event processed');
  });

  it('logs an error instead of throwing when the dispatch rejects', async () => {
    const dispatchError = new Error('dispatch failed');
    let rejectDispatch: (error: Error) => void = () => {};
    dispatchBaseBranchUpdateMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDispatch = reject;
      }),
    );
    const context = createContext();
    const payload = { ref: 'refs/heads/main' } as unknown as PushEvent;

    await handlePush(payload, context);
    rejectDispatch(dispatchError);
    // Yield so the fire-and-forget rejection handler runs.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(context.logger.error).toHaveBeenCalledWith(
      { error: dispatchError },
      'Base branch push handler failed',
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
