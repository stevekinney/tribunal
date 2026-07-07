import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckSuiteEvent } from '@octokit/webhooks-types';
import { handleCheckSuite } from './check-suite.server';
import type { WebhookContext } from './types';

const dispatchCheckCompletedSignalsMock = vi.hoisted(() => vi.fn());
const dispatchManualReviewSignalMock = vi.hoisted(() => vi.fn());

vi.mock('./check-completed-dispatch.server', () => ({
  dispatchCheckCompletedSignals: dispatchCheckCompletedSignalsMock,
}));

vi.mock('./manual-review-dispatch.server', () => ({
  dispatchManualReviewSignal: dispatchManualReviewSignalMock,
}));

describe('handleCheckSuite', () => {
  beforeEach(() => {
    dispatchCheckCompletedSignalsMock.mockReset().mockResolvedValue(undefined);
    dispatchManualReviewSignalMock.mockReset().mockResolvedValue(undefined);
  });

  it('dispatches check-completed signals for check_suite.completed', async () => {
    await handleCheckSuite(createPayload('completed'), createContext());

    expect(dispatchCheckCompletedSignalsMock).toHaveBeenCalledTimes(1);
    expect(dispatchManualReviewSignalMock).not.toHaveBeenCalled();
  });

  it('dispatches a manual review signal for check_suite.rerequested without a check run id', async () => {
    await handleCheckSuite(createPayload('rerequested'), createContext());

    expect(dispatchManualReviewSignalMock).toHaveBeenCalledTimes(1);
    const call = dispatchManualReviewSignalMock.mock.calls[0][0];
    expect(call).toMatchObject({
      eventLabel: 'check_suite.rerequested',
      headSha: 'abc123',
    });
    expect(call.checkRunId).toBeUndefined();
  });

  it('no-ops for other check_suite actions', async () => {
    await handleCheckSuite(createPayload('requested'), createContext());

    expect(dispatchCheckCompletedSignalsMock).not.toHaveBeenCalled();
    expect(dispatchManualReviewSignalMock).not.toHaveBeenCalled();
  });
});

function createPayload(action: string): CheckSuiteEvent {
  return {
    action,
    check_suite: {
      head_sha: 'abc123',
      pull_requests: [{ number: 7 }],
    },
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: { login: 'steve' },
  } as unknown as CheckSuiteEvent;
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
