import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubServiceContext } from '../context.js';
import { releaseWebhookDeliveryClaim } from './claim-delivery.js';

function createReleaseContext(returnedRows: Array<{ id: number }>): GithubServiceContext {
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn(() => ({ returning }));
  const deleteMock = vi.fn(() => ({ where }));

  return {
    db: {
      delete: deleteMock,
    } as unknown as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
  };
}

describe('releaseWebhookDeliveryClaim', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true only when a delivery claim row is deleted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      releaseWebhookDeliveryClaim(createReleaseContext([{ id: 1 }]), 'delivery-1', 'pull_request'),
    ).resolves.toBe(true);

    await expect(
      releaseWebhookDeliveryClaim(createReleaseContext([]), 'delivery-1', 'pull_request'),
    ).resolves.toBe(false);
  });
});
