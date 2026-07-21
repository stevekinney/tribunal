import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv, webhookUtils, handlers, router } = vi.hoisted(() => {
  const mockEnv = {
    GITHUB_APP_WEBHOOK_SECRET: 'test-secret',
    GITHUB_APP_ID: 'app-1',
  } as Record<string, string | undefined>;

  const webhookUtils = {
    validateRequest: vi.fn(),
    verifySignature: vi.fn(),
    extractEventFields: vi.fn(() => ({})),
    getRepositoryIdentity: vi.fn(() => ({ owner: 'acme', repo: 'widgets' })),
    invalidateGitHubAccessCacheForEvent: vi.fn(async () => {}),
    invalidateGitHubResourceCacheForEvent: vi.fn(async () => {}),
    dispatchPRStateTracking: vi.fn(),
    handleRepositoryMetadataEvents: vi.fn(async () => {}),
    isPullRequestWebhookEvent: vi.fn(() => false),
    isRerunTriggerWebhookEvent: vi.fn(() => false),
  };

  const handlers = {
    handlePullRequestEvent: vi.fn(async () => {}),
    handlePullRequestReview: vi.fn(async () => {}),
    handlePullRequestReviewComment: vi.fn(async () => {}),
    handleCheckRun: vi.fn(async () => {}),
    handleCheckSuite: vi.fn(async () => {}),
    handleInstallation: vi.fn(async () => {}),
    handleInstallationRepositories: vi.fn(async () => {}),
    handleInstallationTarget: vi.fn(async () => {}),
    handleAuthorization: vi.fn(async () => {}),
    handlePush: vi.fn(async () => {}),
    handleIssueComment: vi.fn(async () => {}),
    handleReviewThread: vi.fn(async () => {}),
  };

  // Fake router: a payload with `__route` set dispatches the matching typed
  // handler passed into createGithubWebhookRouter; otherwise no handler runs
  // (simulating a Zod schema validation miss).
  const router = {
    createGithubWebhookRouter: vi.fn((handlerMap: Record<string, (event: unknown) => void>) => {
      return (payload: { __route?: string }) => {
        const route = payload.__route;
        if (route && handlerMap[route]) handlerMap[route](payload);
      };
    }),
  };

  return { mockEnv, webhookUtils, handlers, router };
});

const mockClaimWebhookDelivery = vi.hoisted(() => vi.fn(async () => true));
const mockReleaseWebhookDeliveryClaim = vi.hoisted(() => vi.fn(async () => true));
const mockStoreWebhookEvent = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
const mockMatchAndPersistEventListenerDeliveries = vi.hoisted(() => vi.fn(async () => {}));
const mockDrainEventListenerDeliveries = vi.hoisted(() => vi.fn(async () => {}));
const mockGetRegisteredWebhooks = vi.hoisted(() =>
  vi.fn(async (): Promise<{ webhooks: Array<{ id: number }> }> => ({ webhooks: [] })),
);

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('$lib/server/github/webhooks', () => webhookUtils);
vi.mock('github-webhook-schemas/registry', () => router);

vi.mock('@tribunal/github/webhooks/webhook-events', () => ({
  storeWebhookEvent: mockStoreWebhookEvent,
}));
vi.mock('@tribunal/github/webhooks/event-listener-matching', () => ({
  matchAndPersistEventListenerDeliveries: mockMatchAndPersistEventListenerDeliveries,
}));
vi.mock('@tribunal/github/webhooks/event-listener-dispatch', () => ({
  drainEventListenerDeliveries: mockDrainEventListenerDeliveries,
}));
vi.mock('@tribunal/github/webhooks/claim-delivery', () => ({
  claimWebhookDelivery: mockClaimWebhookDelivery,
  releaseWebhookDeliveryClaim: mockReleaseWebhookDeliveryClaim,
}));
vi.mock('@tribunal/github/webhooks/registered-webhooks', () => ({
  getRegisteredWebhooks: mockGetRegisteredWebhooks,
}));

vi.mock('./handlers/pull-request.server', () => ({
  handlePullRequestEvent: handlers.handlePullRequestEvent,
}));
vi.mock('./handlers/pull-request-review.server', () => ({
  handlePullRequestReview: handlers.handlePullRequestReview,
}));
vi.mock('./handlers/pull-request-review-comment.server', () => ({
  handlePullRequestReviewComment: handlers.handlePullRequestReviewComment,
}));
vi.mock('./handlers/check-run.server', () => ({ handleCheckRun: handlers.handleCheckRun }));
vi.mock('./handlers/check-suite.server', () => ({ handleCheckSuite: handlers.handleCheckSuite }));
vi.mock('./handlers/installation-lifecycle.server', () => ({
  handleInstallation: handlers.handleInstallation,
}));
vi.mock('./handlers/installation-repositories-lifecycle.server', () => ({
  handleInstallationRepositories: handlers.handleInstallationRepositories,
}));
vi.mock('./handlers/installation-target-lifecycle.server', () => ({
  handleInstallationTarget: handlers.handleInstallationTarget,
}));
vi.mock('./handlers/authorization-lifecycle.server', () => ({
  handleAuthorization: handlers.handleAuthorization,
}));
vi.mock('./handlers/push-lifecycle.server', () => ({ handlePush: handlers.handlePush }));
vi.mock('./handlers/issue-comment.server', () => ({
  handleIssueComment: handlers.handleIssueComment,
}));
vi.mock('./handlers/review-thread.server', () => ({
  handleReviewThread: handlers.handleReviewThread,
}));

import { GET, POST } from './+server';

function createPostEvent(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request('https://tribunal.dev/api/webhooks/github', {
    method: 'POST',
    headers: {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    request,
    url: new URL('https://tribunal.dev/api/webhooks/github'),
  } as never;
}

describe('POST /api/webhooks/github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.GITHUB_APP_WEBHOOK_SECRET = 'test-secret';
    mockEnv.GITHUB_APP_ID = 'app-1';
    webhookUtils.validateRequest.mockImplementation(async (request: Request) => ({
      payload: await request.text(),
      signature: 'sha256=valid',
      eventType: request.headers.get('x-github-event'),
      deliveryId: request.headers.get('x-github-delivery'),
    }));
    webhookUtils.verifySignature.mockResolvedValue(undefined);
    webhookUtils.isPullRequestWebhookEvent.mockReturnValue(false);
    webhookUtils.isRerunTriggerWebhookEvent.mockReturnValue(false);
    mockClaimWebhookDelivery.mockResolvedValue(true);
    mockReleaseWebhookDeliveryClaim.mockResolvedValue(true);
    mockStoreWebhookEvent.mockResolvedValue({ id: 1 });
    mockMatchAndPersistEventListenerDeliveries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 when the webhook secret is not configured', async () => {
    mockEnv.GITHUB_APP_WEBHOOK_SECRET = undefined;

    await expect(POST(createPostEvent({ action: 'opened' }))).rejects.toMatchObject({
      status: 500,
    });
  });

  it('short-circuits on a duplicate delivery without dispatching any handler', async () => {
    mockClaimWebhookDelivery.mockResolvedValue(false);

    const response = await POST(
      createPostEvent(
        { installation: { id: 1 }, repository: { id: 2 } },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(await response.json()).toEqual({ ok: true, message: 'Already processed' });
    expect(handlers.handlePullRequestEvent).not.toHaveBeenCalled();
  });

  it('ignores a pre-database check_run event (not completed, not a rerun trigger) and still drains listeners', async () => {
    const response = await POST(
      createPostEvent(
        { action: 'created', installation: { id: 1 }, repository: { id: 2 } },
        { 'x-github-event': 'check_run' },
      ),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(mockDrainEventListenerDeliveries).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it('returns ok without dispatching when deliveryId or eventType is missing', async () => {
    const response = await POST(createPostEvent({}, { 'x-github-delivery': '' }));

    expect(await response.json()).toEqual({ ok: true });
  });

  it('dispatches a router-handled event, then metadata/cache/PR-state and drain', async () => {
    const response = await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(handlers.handlePullRequestEvent).toHaveBeenCalledTimes(1);
    expect(webhookUtils.handleRepositoryMetadataEvents).toHaveBeenCalledTimes(1);
    expect(webhookUtils.invalidateGitHubAccessCacheForEvent).toHaveBeenCalledTimes(1);
    expect(webhookUtils.dispatchPRStateTracking).toHaveBeenCalledTimes(1);
    expect(mockDrainEventListenerDeliveries).toHaveBeenCalledWith(expect.anything(), 2);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('dispatches the issue_comment fallback handler (no router schema)', async () => {
    await POST(
      createPostEvent(
        { action: 'created', installation: { id: 1 }, repository: { id: 2 } },
        { 'x-github-event': 'issue_comment' },
      ),
    );

    expect(handlers.handleIssueComment).toHaveBeenCalledTimes(1);
  });

  it('dispatches the pull_request_review_thread fallback handler (no router schema)', async () => {
    await POST(
      createPostEvent(
        { action: 'resolved', installation: { id: 1 }, repository: { id: 2 } },
        { 'x-github-event': 'pull_request_review_thread' },
      ),
    );

    expect(handlers.handleReviewThread).toHaveBeenCalledTimes(1);
  });

  it('throws, releases the claim, and returns 500 when a review-engine trigger fails schema validation', async () => {
    webhookUtils.isPullRequestWebhookEvent.mockReturnValue(true);

    await expect(
      POST(
        createPostEvent(
          { action: 'opened', installation: { id: 1 }, repository: { id: 2 } },
          { 'x-github-event': 'pull_request' },
        ),
      ),
    ).rejects.toMatchObject({ status: 500 });

    expect(mockReleaseWebhookDeliveryClaim).toHaveBeenCalledWith(
      expect.anything(),
      'delivery-1',
      'pull_request',
    );
  });

  it('returns 500 with a distinct message when releasing the claim also fails', async () => {
    webhookUtils.isPullRequestWebhookEvent.mockReturnValue(true);
    mockReleaseWebhookDeliveryClaim.mockResolvedValue(false);

    await expect(
      POST(
        createPostEvent(
          { action: 'opened', installation: { id: 1 }, repository: { id: 2 } },
          { 'x-github-event': 'pull_request' },
        ),
      ),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('logs and continues for a non-review-engine handler failure instead of throwing', async () => {
    handlers.handleCheckSuite.mockRejectedValueOnce(new Error('boom'));

    const response = await POST(
      createPostEvent(
        {
          __route: 'checkSuite',
          action: 'completed',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'check_suite' },
      ),
    );

    expect(await response.json()).toEqual({ ok: true });
    expect(webhookUtils.handleRepositoryMetadataEvents).toHaveBeenCalledTimes(1);
  });

  it('retries storing the webhook event up to 3 times before giving up', async () => {
    mockStoreWebhookEvent
      .mockRejectedValueOnce(new Error('db blip'))
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({ id: 5 });

    await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(mockStoreWebhookEvent).toHaveBeenCalledTimes(3);
    expect(mockMatchAndPersistEventListenerDeliveries).toHaveBeenCalledWith(expect.anything(), {
      id: 5,
    });
  });

  it('logs and continues when every store-webhook-event attempt fails', async () => {
    mockStoreWebhookEvent.mockRejectedValue(new Error('db down'));

    const response = await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(mockMatchAndPersistEventListenerDeliveries).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true });
  });

  it('dispatches every other router-handled route at least once', async () => {
    // check_run/check_suite need action:'completed' to clear the
    // pre-database-ignore gate; every other route is unaffected by it.
    const cases: Array<[string, string, string, () => ReturnType<typeof vi.fn>]> = [
      [
        'pullRequestReview',
        'pull_request_review',
        'submitted',
        () => handlers.handlePullRequestReview,
      ],
      [
        'pullRequestReviewComment',
        'pull_request_review_comment',
        'created',
        () => handlers.handlePullRequestReviewComment,
      ],
      ['checkRun', 'check_run', 'completed', () => handlers.handleCheckRun],
      ['installation', 'installation', 'created', () => handlers.handleInstallation],
      [
        'installationRepositories',
        'installation_repositories',
        'added',
        () => handlers.handleInstallationRepositories,
      ],
      [
        'installationTarget',
        'installation_target',
        'renamed',
        () => handlers.handleInstallationTarget,
      ],
      [
        'githubAppAuthorization',
        'github_app_authorization',
        'revoked',
        () => handlers.handleAuthorization,
      ],
      ['push', 'push', 'n/a', () => handlers.handlePush],
    ];

    for (const [route, eventType, action, getHandlerMock] of cases) {
      await POST(
        createPostEvent(
          { __route: route, action, installation: { id: 1 }, repository: { id: 2 } },
          { 'x-github-event': eventType, 'x-github-delivery': `delivery-${route}` },
        ),
      );
      expect(getHandlerMock()).toHaveBeenCalledTimes(1);
    }
  });

  it('exercises the request-scoped logger passed to handlers', async () => {
    handlers.handlePullRequestEvent.mockImplementationOnce(async (..._args: unknown[]) => {
      const context = _args[1] as { logger: Record<string, (...values: unknown[]) => unknown> };
      context.logger.debug('debug message');
      context.logger.info('info message');
      context.logger.warn('warn message');
      context.logger.error('error message');
      (context.logger.child({}) as Record<string, (...values: unknown[]) => unknown>).debug(
        'nested',
      );
    });

    await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(handlers.handlePullRequestEvent).toHaveBeenCalledTimes(1);
  });

  it('retries matching event listeners up to 3 times before giving up', async () => {
    mockMatchAndPersistEventListenerDeliveries
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);

    await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(mockMatchAndPersistEventListenerDeliveries).toHaveBeenCalledTimes(2);
  });

  it('logs but does not fail the response when the fire-and-forget listener drain rejects', async () => {
    mockDrainEventListenerDeliveries.mockRejectedValue(new Error('drain failed'));

    const response = await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(await response.json()).toEqual({ ok: true });
    // Yield so the un-awaited drain's rejection handler runs before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('logs and continues when every listener-matching attempt fails', async () => {
    mockMatchAndPersistEventListenerDeliveries.mockRejectedValue(new Error('persistent failure'));

    const response = await POST(
      createPostEvent(
        {
          __route: 'pullRequest',
          action: 'opened',
          installation: { id: 1 },
          repository: { id: 2 },
        },
        { 'x-github-event': 'pull_request' },
      ),
    );

    expect(mockMatchAndPersistEventListenerDeliveries).toHaveBeenCalledTimes(3);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('GET /api/webhooks/github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRegisteredWebhooks.mockResolvedValue({ webhooks: [] });
  });

  it('requires authentication', async () => {
    await expect(GET({ locals: {} } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('returns the registered webhooks for an authenticated user', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({ webhooks: [{ id: 1 }] });

    const response = await GET({ locals: { user: { id: 1 } } } as never);

    expect(await response.json()).toEqual({ webhooks: [{ id: 1 }] });
  });

  it('returns 400 when the GitHub App is not configured', async () => {
    const { ValidationError } = await import('@tribunal/github/error-taxonomy');
    mockGetRegisteredWebhooks.mockRejectedValue(new ValidationError('not configured'));

    const response = await GET({ locals: { user: { id: 1 } } } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'GitHub App is not configured' });
  });

  it('returns 502 on an unexpected error', async () => {
    mockGetRegisteredWebhooks.mockRejectedValue(new Error('network error'));

    const response = await GET({ locals: { user: { id: 1 } } } as never);

    expect(response.status).toBe(502);
  });
});
