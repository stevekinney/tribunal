import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { githubWebhookDelivery } from '@tribunal/database/schema';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import type { GithubServiceContext } from '../context.js';
import { claimWebhookDelivery, releaseWebhookDeliveryClaim } from './claim-delivery.js';

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

  it('logs and returns false when the delete query itself throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context: GithubServiceContext = {
      db: {
        delete: vi.fn(() => {
          throw new Error('connection reset');
        }),
      } as unknown as GithubServiceContext['db'],
      cache: {} as GithubServiceContext['cache'],
      getInstallationOctokit: vi.fn(),
    };

    await expect(releaseWebhookDeliveryClaim(context, 'delivery-1', 'pull_request')).resolves.toBe(
      false,
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[github-webhook] Failed to release delivery claim:',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        eventType: 'pull_request',
        error: expect.any(Error),
      }),
    );
  });
});

describe('claimWebhookDelivery (idempotent redelivery / single-claim guarantee)', () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = await createTestContext();
  });

  afterAll(async () => {
    await testContext.close();
  });

  beforeEach(async () => {
    await testContext.reset();
  });

  function createGithubContext(): GithubServiceContext {
    return {
      db: testContext.db as unknown as GithubServiceContext['db'],
      cache: {} as GithubServiceContext['cache'],
      getInstallationOctokit: vi.fn(),
    };
  }

  it('claims a not-yet-seen delivery', async () => {
    const context = createGithubContext();

    const claimed = await claimWebhookDelivery(context, 'delivery-1', 'pull_request', 42);

    expect(claimed).toBe(true);

    const [row] = await testContext.db
      .select()
      .from(githubWebhookDelivery)
      .where(eq(githubWebhookDelivery.deliveryId, 'delivery-1'));
    expect(row).toMatchObject({
      deliveryId: 'delivery-1',
      eventType: 'pull_request',
      installationId: 42,
    });
  });

  it('a redelivered webhook (same deliveryId) is claimed by exactly one caller, never twice', async () => {
    const context = createGithubContext();

    const first = await claimWebhookDelivery(context, 'delivery-1', 'pull_request');
    const redelivery = await claimWebhookDelivery(context, 'delivery-1', 'pull_request');

    expect(first).toBe(true);
    expect(redelivery).toBe(false);

    const rows = await testContext.db
      .select()
      .from(githubWebhookDelivery)
      .where(eq(githubWebhookDelivery.deliveryId, 'delivery-1'));
    expect(rows).toHaveLength(1);
  });

  it('two concurrent claims for the same deliveryId only ever let one caller proceed', async () => {
    const context = createGithubContext();

    const [first, second] = await Promise.all([
      claimWebhookDelivery(context, 'delivery-concurrent', 'push'),
      claimWebhookDelivery(context, 'delivery-concurrent', 'push'),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);

    const rows = await testContext.db
      .select()
      .from(githubWebhookDelivery)
      .where(eq(githubWebhookDelivery.deliveryId, 'delivery-concurrent'));
    expect(rows).toHaveLength(1);
  });

  it('claims distinct deliveryIds independently', async () => {
    const context = createGithubContext();

    const a = await claimWebhookDelivery(context, 'delivery-a', 'issues');
    const b = await claimWebhookDelivery(context, 'delivery-b', 'issues');

    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
