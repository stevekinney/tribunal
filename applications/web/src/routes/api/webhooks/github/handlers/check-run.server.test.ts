import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckRunEvent } from '@octokit/webhooks-types';
import { handleCheckRun } from './check-run.server';
import type { WebhookContext } from './types';

const dispatchCheckCompletedSignalsMock = vi.hoisted(() => vi.fn());
const dispatchManualReviewSignalMock = vi.hoisted(() => vi.fn());

vi.mock('./check-completed-dispatch.server', () => ({
  dispatchCheckCompletedSignals: dispatchCheckCompletedSignalsMock,
}));

vi.mock('./manual-review-dispatch.server', () => ({
  dispatchManualReviewSignal: dispatchManualReviewSignalMock,
}));

describe('handleCheckRun', () => {
  beforeEach(() => {
    dispatchCheckCompletedSignalsMock.mockReset().mockResolvedValue(undefined);
    dispatchManualReviewSignalMock.mockReset().mockResolvedValue(undefined);
  });

  it('dispatches check-completed signals for check_run.completed', async () => {
    await handleCheckRun(createPayload('completed'), createContext());

    expect(dispatchCheckCompletedSignalsMock).toHaveBeenCalledTimes(1);
    expect(dispatchManualReviewSignalMock).not.toHaveBeenCalled();
  });

  it('dispatches a manual review signal for check_run.rerequested', async () => {
    await handleCheckRun(createPayload('rerequested'), createContext());

    expect(dispatchManualReviewSignalMock).toHaveBeenCalledTimes(1);
    expect(dispatchManualReviewSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventLabel: 'check_run.rerequested',
        headSha: 'abc123',
        checkRunId: 555,
      }),
      expect.anything(),
    );
    expect(dispatchCheckCompletedSignalsMock).not.toHaveBeenCalled();
  });

  it('dispatches a manual review signal for check_run.requested_action with the re-review identifier', async () => {
    await handleCheckRun(
      createPayload('requested_action', { identifier: 're-review' }),
      createContext(),
    );

    expect(dispatchManualReviewSignalMock).toHaveBeenCalledTimes(1);
    expect(dispatchManualReviewSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventLabel: 'check_run.requested_action', checkRunId: 555 }),
      expect.anything(),
    );
  });

  it('no-ops for check_run.requested_action with an unknown identifier', async () => {
    const context = createContext();
    await handleCheckRun(
      createPayload('requested_action', { identifier: 'some-other-action' }),
      context,
    );

    expect(dispatchManualReviewSignalMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'some-other-action' }),
      expect.stringContaining('Ignoring unknown'),
    );
  });

  it('no-ops for other check_run actions', async () => {
    const context = createContext();
    await handleCheckRun(createPayload('created'), context);

    expect(dispatchCheckCompletedSignalsMock).not.toHaveBeenCalled();
    expect(dispatchManualReviewSignalMock).not.toHaveBeenCalled();
  });
});

function createPayload(action: string, requestedAction?: { identifier: string }): CheckRunEvent {
  return {
    action,
    check_run: {
      id: 555,
      head_sha: 'abc123',
      pull_requests: [{ number: 7 }],
    },
    requested_action: requestedAction,
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: { login: 'steve' },
  } as unknown as CheckRunEvent;
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
