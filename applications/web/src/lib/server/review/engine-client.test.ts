import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelInstallationSyncEngine,
  cancelReviewWorkflowsEngine,
  createFailedWorkflowCancellationResult,
  ENGINE_CONTROL_REQUEST_TIMEOUT_MS,
  ENGINE_WORKFLOW_CANCELLATION_REQUEST_MAXIMUM_TIMEOUT_MS,
  ENGINE_WORKFLOW_CANCELLATION_REQUEST_MINIMUM_TIMEOUT_MS,
  kickReviewEngine,
  parseWorkflowCancellationResult,
  postReviewEngineControl,
  signalInstallationSyncEngine,
  workflowCancellationRequestTimeoutMs,
} from './engine-client';

const mocks = vi.hoisted(() => ({
  env: {
    TRIBUNAL_ENGINE_URL: '',
    TRIBUNAL_ENGINE_CONTROL_TOKEN: '',
  },
}));

vi.mock('$env/dynamic/private', () => ({
  env: mocks.env,
}));

describe('review engine client', () => {
  beforeEach(() => {
    mocks.env.TRIBUNAL_ENGINE_URL = '';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send engine requests when engine control is unconfigured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(postReviewEngineControl('/review-intents/kick')).resolves.toEqual({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL', 'TRIBUNAL_ENGINE_CONTROL_TOKEN'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts control requests with the configured bearer token', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 202,
      }),
    );

    await expect(kickReviewEngine()).resolves.toEqual({
      status: 'sent',
      ok: true,
      responseStatus: 202,
      body: {},
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://tribunal-engine.flycast/review-intents/kick'),
      {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('preserves non-JSON control response bodies as text', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('accepted', {
        status: 202,
      }),
    );

    await expect(kickReviewEngine()).resolves.toEqual({
      status: 'sent',
      ok: true,
      responseStatus: 202,
      body: 'accepted',
    });
  });

  it('reports fetch failures without throwing', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const error = new Error('engine unavailable');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);

    await expect(kickReviewEngine()).resolves.toEqual({ status: 'failed', error });
  });

  it('aborts stalled engine control requests', async () => {
    vi.useFakeTimers();
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason));
      });
    });

    const result = kickReviewEngine();
    await vi.advanceTimersByTimeAsync(ENGINE_CONTROL_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      status: 'failed',
      error: expect.any(Error),
    });
    expect(signal?.aborted).toBe(true);
  });

  it('posts installation sync dispatches to the engine receiver', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 202,
      }),
    );
    const options = {
      installationId: 100,
      reason: 'webhook:installation.created',
      workspaceId: 7,
      deliveryId: 'delivery-1',
    };

    await expect(signalInstallationSyncEngine(options)).resolves.toEqual({
      status: 'sent',
      ok: true,
      responseStatus: 202,
      body: {},
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://tribunal-engine.flycast/installation-syncs'),
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer control-token',
          'content-type': 'application/json',
        },
        signal: expect.any(AbortSignal),
        body: JSON.stringify(options),
      },
    );
  });

  it('posts installation sync cancellations to the engine owner', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 202,
      }),
    );

    await expect(cancelInstallationSyncEngine(100)).resolves.toEqual({
      status: 'sent',
      ok: true,
      responseStatus: 202,
      body: {},
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://tribunal-engine.flycast/installation-syncs/100/cancel'),
      {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('posts workflow cancellations to the engine owner', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 202,
      }),
    );

    await expect(cancelReviewWorkflowsEngine(['review:pr:42:7'])).resolves.toEqual({
      status: 'sent',
      ok: true,
      responseStatus: 202,
      body: {},
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://tribunal-engine.flycast/workflows/cancel'),
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer control-token',
          'content-type': 'application/json',
        },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({ workflowIds: ['review:pr:42:7'] }),
      },
    );
  });

  it('uses a workload-aware timeout for workflow cancellation requests', async () => {
    vi.useFakeTimers();
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason));
      });
    });

    const result = cancelReviewWorkflowsEngine(['review:pr:42:7']);
    await vi.advanceTimersByTimeAsync(ENGINE_CONTROL_REQUEST_TIMEOUT_MS);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(
      ENGINE_WORKFLOW_CANCELLATION_REQUEST_MINIMUM_TIMEOUT_MS - ENGINE_CONTROL_REQUEST_TIMEOUT_MS,
    );

    await expect(result).resolves.toEqual({
      status: 'failed',
      error: expect.any(Error),
    });
    expect(signal?.aborted).toBe(true);
  });

  it('maps failed workflow cancellation delivery to per-workflow failures', () => {
    expect(
      createFailedWorkflowCancellationResult(['review:pr:42:7', 'review:pr:42:8'], 'offline'),
    ).toEqual({
      cancelled: 0,
      failed: 2,
      errors: ['review:pr:42:7: offline', 'review:pr:42:8: offline'],
    });
  });

  it('parses structured workflow cancellation response bodies', () => {
    expect(
      parseWorkflowCancellationResult({
        ok: false,
        cancelled: 1,
        failed: 1,
        errors: ['review:pr:42:8: storage unavailable'],
      }),
    ).toEqual({
      cancelled: 1,
      failed: 1,
      errors: ['review:pr:42:8: storage unavailable'],
    });
  });

  it('rejects malformed workflow cancellation response bodies', () => {
    expect(parseWorkflowCancellationResult({ cancelled: 1, failed: 1, errors: [42] })).toBeNull();
  });

  it('bounds workflow cancellation request timeout by batch size', () => {
    expect(workflowCancellationRequestTimeoutMs(['review:pr:42:7'])).toBe(
      ENGINE_WORKFLOW_CANCELLATION_REQUEST_MINIMUM_TIMEOUT_MS,
    );
    expect(workflowCancellationRequestTimeoutMs(Array.from({ length: 40 }, String))).toBe(
      ENGINE_WORKFLOW_CANCELLATION_REQUEST_MAXIMUM_TIMEOUT_MS,
    );
  });
});
