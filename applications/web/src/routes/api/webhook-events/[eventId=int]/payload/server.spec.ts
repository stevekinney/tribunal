import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const mocks = vi.hoisted(() => ({
  getRepositoriesForUser: vi.fn(),
  getWebhookEventPayload: vi.fn(),
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mocks.getRepositoriesForUser,
}));
vi.mock('$lib/server/webhook-events', () => ({
  getWebhookEventPayload: mocks.getWebhookEventPayload,
}));

function get(eventId: string, user?: { id: number }) {
  return GET({ locals: user ? { user } : {}, params: { eventId } } as never);
}

describe('GET /api/webhook-events/[eventId=int]/payload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [{ repository: { id: 42 } }],
    });
  });

  it('returns JSON 401 without resolving repository access when unauthenticated', async () => {
    const response = await get('1');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: 'Authentication required.' });
    expect(mocks.getRepositoriesForUser).not.toHaveBeenCalled();
  });

  it('returns 401 when the user has no GitHub connection', async () => {
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'no_github_token' });
    const response = await get('1', { id: 7 });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: 'Authentication required.' });
  });

  it('returns 503 when repository access cannot be verified', async () => {
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'github_unavailable' });
    const response = await get('1', { id: 7 });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message: 'Unable to verify repository access.',
    });
  });

  it.each(['0', '9007199254740992'])(
    'returns the non-disclosing 404 for invalid id %s',
    async (eventId) => {
      const response = await get(eventId, { id: 7 });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ message: 'Webhook event not found.' });
      expect(mocks.getRepositoriesForUser).not.toHaveBeenCalled();
      expect(mocks.getWebhookEventPayload).not.toHaveBeenCalled();
    },
  );

  it('returns the non-disclosing 404 for missing or unauthorized events', async () => {
    mocks.getWebhookEventPayload.mockResolvedValue(null);
    const response = await get('1', { id: 7 });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: 'Webhook event not found.' });
    expect(mocks.getWebhookEventPayload).toHaveBeenCalledWith([42], 1);
  });

  it('returns parsed or malformed authorized payloads in one representation', async () => {
    mocks.getWebhookEventPayload
      .mockResolvedValueOnce({ payload: { ok: true }, parseError: false })
      .mockResolvedValueOnce({ payload: 'not json', parseError: true });

    const parsed = await get('1', { id: 7 });
    await expect(parsed.json()).resolves.toEqual({ payload: { ok: true }, parseError: false });
    const malformed = await get('2', { id: 7 });
    await expect(malformed.json()).resolves.toEqual({ payload: 'not json', parseError: true });
  });
});
