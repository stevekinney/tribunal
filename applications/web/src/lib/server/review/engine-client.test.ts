import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kickReviewEngine, postReviewEngineControl } from './engine-client';

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
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://tribunal-engine.flycast/review-intents/kick'),
      {
        method: 'POST',
        headers: { authorization: 'Bearer control-token' },
      },
    );
  });

  it('reports fetch failures without throwing', async () => {
    mocks.env.TRIBUNAL_ENGINE_URL = 'http://tribunal-engine.flycast';
    mocks.env.TRIBUNAL_ENGINE_CONTROL_TOKEN = 'control-token';
    const error = new Error('engine unavailable');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);

    await expect(kickReviewEngine()).resolves.toEqual({ status: 'failed', error });
  });
});
