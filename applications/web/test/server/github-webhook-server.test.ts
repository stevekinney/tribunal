import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimWebhookDeliveryMock = vi.fn();
const dispatchPullRequestStateMock = vi.fn();
const extractEventFieldsMock = vi.fn();
const getRepositoryIdentityMock = vi.fn();
const handlePullRequestEventMock = vi.fn();
const invalidateGitHubResourceCacheForEventMock = vi.fn();
const releaseWebhookDeliveryClaimMock = vi.fn();
const storeWebhookEventMock = vi.fn();
const validateRequestMock = vi.fn();
const verifySignatureMock = vi.fn();
const matchAndPersistEventListenerDeliveriesMock = vi.fn();
const drainEventListenerDeliveriesMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
  env: { GITHUB_APP_WEBHOOK_SECRET: 'webhook-secret' },
}));

vi.mock('$lib/server/github-context', () => ({
  githubContext: { db: {}, cache: {} },
}));

vi.mock('$lib/server/github/webhooks', () => ({
  validateRequest: validateRequestMock,
  verifySignature: verifySignatureMock,
  extractEventFields: extractEventFieldsMock,
  getRepositoryIdentity: getRepositoryIdentityMock,
  invalidateGitHubAccessCacheForEvent: vi.fn(),
  invalidateGitHubResourceCacheForEvent: invalidateGitHubResourceCacheForEventMock,
  dispatchPRStateTracking: dispatchPullRequestStateMock,
  handleRepositoryMetadataEvents: vi.fn(),
  isPullRequestWebhookEvent: vi.fn(() => true),
  isRerunTriggerWebhookEvent: vi.fn(() => false),
}));

vi.mock('@tribunal/github/webhooks/claim-delivery', () => ({
  claimWebhookDelivery: claimWebhookDeliveryMock,
  releaseWebhookDeliveryClaim: releaseWebhookDeliveryClaimMock,
}));

vi.mock('@tribunal/github/webhooks/webhook-events', () => ({
  storeWebhookEvent: storeWebhookEventMock,
}));

vi.mock('@tribunal/github/webhooks/event-listener-matching', () => ({
  matchAndPersistEventListenerDeliveries: matchAndPersistEventListenerDeliveriesMock,
}));

vi.mock('@tribunal/github/webhooks/event-listener-dispatch', () => ({
  drainEventListenerDeliveries: drainEventListenerDeliveriesMock,
}));

vi.mock('github-webhook-schemas/registry', () => ({
  createGithubWebhookRouter:
    (handlers: { pullRequest: (payload: unknown) => void }) => (payload: unknown) => {
      handlers.pullRequest(payload);
    },
}));

vi.mock('../../src/routes/api/webhooks/github/handlers/pull-request.server', () => ({
  handlePullRequestEvent: handlePullRequestEventMock,
}));

vi.mock('../../src/routes/api/webhooks/github/handlers/pull-request-review.server', () => ({
  handlePullRequestReview: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/pull-request-review-comment.server', () => ({
  handlePullRequestReviewComment: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/check-run.server', () => ({
  handleCheckRun: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/check-suite.server', () => ({
  handleCheckSuite: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/installation-lifecycle.server', () => ({
  handleInstallation: vi.fn(),
}));
vi.mock(
  '../../src/routes/api/webhooks/github/handlers/installation-repositories-lifecycle.server',
  () => ({
    handleInstallationRepositories: vi.fn(),
  }),
);
vi.mock(
  '../../src/routes/api/webhooks/github/handlers/installation-target-lifecycle.server',
  () => ({
    handleInstallationTarget: vi.fn(),
  }),
);
vi.mock('../../src/routes/api/webhooks/github/handlers/authorization-lifecycle.server', () => ({
  handleAuthorization: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/push-lifecycle.server', () => ({
  handlePush: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/issue-comment.server', () => ({
  handleIssueComment: vi.fn(),
}));
vi.mock('../../src/routes/api/webhooks/github/handlers/review-thread.server', () => ({
  handleReviewThread: vi.fn(),
}));

const payload = {
  action: 'synchronize',
  installation: { id: 1001 },
  repository: {
    id: 42,
    name: 'tribunal',
    owner: { login: 'lostgradient' },
  },
  sender: { id: 1, login: 'steve' },
  pull_request: {
    number: 7,
    head: { sha: 'aaa111' },
  },
};

function createEvent() {
  return {
    request: new Request('https://tribunal.test/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-hook-id': 'hook-1',
      },
      body: JSON.stringify(payload),
    }),
    url: new URL('https://tribunal.test/api/webhooks/github'),
  };
}

describe('GitHub webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateRequestMock.mockResolvedValue({
      payload: JSON.stringify(payload),
      signature: 'sha256=signature',
      eventType: 'pull_request',
      deliveryId: 'delivery-1',
    });
    verifySignatureMock.mockResolvedValue(undefined);
    getRepositoryIdentityMock.mockReturnValue({ owner: 'lostgradient', repo: 'tribunal' });
    extractEventFieldsMock.mockReturnValue({ pullRequestNumber: 7, commitSha: 'aaa111' });
    storeWebhookEventMock.mockResolvedValue({ id: 999, eventType: 'pull_request' });
    handlePullRequestEventMock.mockResolvedValue(undefined);
    releaseWebhookDeliveryClaimMock.mockResolvedValue(true);
    matchAndPersistEventListenerDeliveriesMock.mockResolvedValue([]);
    drainEventListenerDeliveriesMock.mockResolvedValue({
      attempted: 0,
      dispatched: 0,
      skippedDisabled: 0,
      failed: 0,
    });
  });

  it('claims review-engine deliveries before dispatch so redelivery cannot enqueue twice', async () => {
    expect.assertions(7);
    claimWebhookDeliveryMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { POST } = await import('../../src/routes/api/webhooks/github/+server');

    const firstResponse = await POST(createEvent() as Parameters<typeof POST>[0]);
    const secondResponse = await POST(createEvent() as Parameters<typeof POST>[0]);

    await expect(firstResponse.json()).resolves.toEqual({ ok: true });
    await expect(secondResponse.json()).resolves.toEqual({
      ok: true,
      message: 'Already processed',
    });
    expect(claimWebhookDeliveryMock).toHaveBeenCalledTimes(2);
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1);
    expect(storeWebhookEventMock).toHaveBeenCalledTimes(1);
    expect(claimWebhookDeliveryMock.mock.invocationCallOrder[0]).toBeLessThan(
      storeWebhookEventMock.mock.invocationCallOrder[0],
    );
    expect(claimWebhookDeliveryMock.mock.invocationCallOrder[0]).toBeLessThan(
      handlePullRequestEventMock.mock.invocationCallOrder[0],
    );
  });

  it('claims ignored check suite events before resource cache invalidation', async () => {
    expect.assertions(8);
    claimWebhookDeliveryMock.mockResolvedValueOnce(true);
    const checkSuitePayload = {
      action: 'requested',
      installation: { id: 1001 },
      repository: {
        id: 42,
        name: 'tribunal',
        owner: { login: 'lostgradient' },
      },
      sender: { id: 1, login: 'steve' },
      check_suite: {
        head_sha: 'aaa111',
        pull_requests: [],
      },
    };
    validateRequestMock.mockResolvedValueOnce({
      payload: JSON.stringify(checkSuitePayload),
      signature: 'sha256=signature',
      eventType: 'check_suite',
      deliveryId: 'delivery-1',
    });
    const { POST } = await import('../../src/routes/api/webhooks/github/+server');

    const response = await POST(createEvent() as Parameters<typeof POST>[0]);

    await expect(response.json()).resolves.toEqual({ ok: true, ignored: true });
    expect(verifySignatureMock).toHaveBeenCalledWith(
      JSON.stringify(checkSuitePayload),
      'sha256=signature',
      'webhook-secret',
      { deliveryId: 'delivery-1', eventType: 'check_suite' },
    );
    expect(claimWebhookDeliveryMock).toHaveBeenCalledWith(
      { db: {}, cache: {} },
      'delivery-1',
      'check_suite',
      1001,
    );
    expect(invalidateGitHubResourceCacheForEventMock).toHaveBeenCalledWith(
      { db: {}, cache: {} },
      'check_suite',
      'requested',
      checkSuitePayload,
    );
    expect(claimWebhookDeliveryMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateGitHubResourceCacheForEventMock.mock.invocationCallOrder[0],
    );
    expect(storeWebhookEventMock).not.toHaveBeenCalled();
    expect(handlePullRequestEventMock).not.toHaveBeenCalled();
    expect(dispatchPullRequestStateMock).not.toHaveBeenCalled();
  });

  it('skips duplicate ignored check suite events before resource cache invalidation', async () => {
    expect.assertions(4);
    claimWebhookDeliveryMock.mockResolvedValueOnce(false);
    const checkSuitePayload = {
      action: 'requested',
      installation: { id: 1001 },
      repository: {
        id: 42,
        name: 'tribunal',
        owner: { login: 'lostgradient' },
      },
      sender: { id: 1, login: 'steve' },
      check_suite: {
        head_sha: 'aaa111',
        pull_requests: [],
      },
    };
    validateRequestMock.mockResolvedValueOnce({
      payload: JSON.stringify(checkSuitePayload),
      signature: 'sha256=signature',
      eventType: 'check_suite',
      deliveryId: 'delivery-1',
    });
    const { POST } = await import('../../src/routes/api/webhooks/github/+server');

    const response = await POST(createEvent() as Parameters<typeof POST>[0]);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: 'Already processed',
    });
    expect(claimWebhookDeliveryMock).toHaveBeenCalledTimes(1);
    expect(invalidateGitHubResourceCacheForEventMock).not.toHaveBeenCalled();
    expect(storeWebhookEventMock).not.toHaveBeenCalled();
  });

  it('releases review-engine delivery claims when dispatch fails so redelivery can retry', async () => {
    expect.assertions(6);
    claimWebhookDeliveryMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    handlePullRequestEventMock
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);
    const { POST } = await import('../../src/routes/api/webhooks/github/+server');

    await expect(POST(createEvent() as Parameters<typeof POST>[0])).rejects.toMatchObject({
      status: 500,
    });

    const retryResponse = await POST(createEvent() as Parameters<typeof POST>[0]);

    await expect(retryResponse.json()).resolves.toEqual({ ok: true });
    expect(claimWebhookDeliveryMock).toHaveBeenCalledTimes(2);
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(2);
    expect(releaseWebhookDeliveryClaimMock).toHaveBeenCalledWith(
      { db: {}, cache: {} },
      'delivery-1',
      'pull_request',
    );
    expect(releaseWebhookDeliveryClaimMock.mock.invocationCallOrder[0]).toBeLessThan(
      claimWebhookDeliveryMock.mock.invocationCallOrder[1],
    );
  });

  it('surfaces release failures when review-engine dispatch fails after claiming', async () => {
    expect.assertions(4);
    claimWebhookDeliveryMock.mockResolvedValueOnce(true);
    handlePullRequestEventMock.mockRejectedValueOnce(new Error('database unavailable'));
    releaseWebhookDeliveryClaimMock.mockResolvedValueOnce(false);
    const { POST } = await import('../../src/routes/api/webhooks/github/+server');

    await expect(POST(createEvent() as Parameters<typeof POST>[0])).rejects.toMatchObject({
      status: 500,
      body: {
        message: 'Review intent dispatch failed and delivery claim could not be released',
      },
    });

    expect(claimWebhookDeliveryMock).toHaveBeenCalledTimes(1);
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1);
    expect(releaseWebhookDeliveryClaimMock).toHaveBeenCalledWith(
      { db: {}, cache: {} },
      'delivery-1',
      'pull_request',
    );
  });
});
