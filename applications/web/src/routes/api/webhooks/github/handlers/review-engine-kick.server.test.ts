import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasDurableReviewIntentForDrain,
  kickReviewEngineAfterDurableIntent,
  kickReviewEngineAfterDurableIntentCount,
} from './review-engine-kick.server';
import type { WebhookLogger } from './types';

const kickReviewEngineMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/review/engine-client', () => ({
  kickReviewEngine: kickReviewEngineMock,
}));

describe('review engine kick webhook helper', () => {
  beforeEach(() => {
    kickReviewEngineMock.mockReset();
  });

  it('treats inserted and duplicate durable intents as work that must wake the engine', () => {
    expect(hasDurableReviewIntentForDrain({ enqueued: true, enqueueStatus: 'enqueued' })).toBe(
      true,
    );
    expect(hasDurableReviewIntentForDrain({ enqueued: false, enqueueStatus: 'duplicate' })).toBe(
      true,
    );
    expect(hasDurableReviewIntentForDrain({ enqueued: false, enqueueStatus: 'no_watchers' })).toBe(
      false,
    );
  });

  it('awaits a kick for duplicate durable intents so GitHub retries can wake existing rows', async () => {
    kickReviewEngineMock.mockResolvedValue({ status: 'sent', ok: true, responseStatus: 202 });

    await expect(
      kickReviewEngineAfterDurableIntent(
        { enqueued: false, enqueueStatus: 'duplicate' },
        createLogger(),
      ),
    ).resolves.toBeUndefined();

    expect(kickReviewEngineMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the review engine kick is not configured', async () => {
    kickReviewEngineMock.mockResolvedValue({
      status: 'not_configured',
      missingSettings: ['TRIBUNAL_ENGINE_URL'],
    });

    await expect(kickReviewEngineAfterDurableIntentCount(1, createLogger())).rejects.toThrow(
      'Review engine control is not configured. Missing settings: TRIBUNAL_ENGINE_URL.',
    );
  });

  it('throws when the review engine returns a non-success status', async () => {
    kickReviewEngineMock.mockResolvedValue({ status: 'sent', ok: false, responseStatus: 503 });

    await expect(kickReviewEngineAfterDurableIntentCount(1, createLogger())).rejects.toThrow(
      'Review engine kick failed with status 503.',
    );
  });
});

function createLogger(): WebhookLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createLogger()),
  };
}
