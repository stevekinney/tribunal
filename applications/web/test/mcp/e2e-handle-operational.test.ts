import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ E2E_TEST_MODE: '1' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ building: false, dev: true }));

import type { RequestEvent } from '@sveltejs/kit';
import { e2eHandle } from '$testing/end-to-end/handle';

/**
 * TRI-52: `e2eHandle` is the earliest identity-populating handle in the sequence
 * and does database-backed session work under E2E_TEST_MODE. Operational paths
 * must dispatch ahead of that hydration here too, or /health/ready and /metrics
 * would block on test-database init or cookie validation in E2E mode. This test
 * lives outside `test/end-to-end/**` (which Playwright owns and vitest excludes)
 * so the vitest server project collects it.
 */
describe('e2eHandle operational-path bypass (TRI-52)', () => {
  beforeEach(() => {
    mockEnv.E2E_TEST_MODE = '1';
  });

  it.each(['/health', '/health/ready', '/metrics'])(
    'skips E2E session hydration for %s even with a forged cookie',
    async (pathname) => {
      const cookieGet = vi.fn((name: string) =>
        name === 'tribunal-neon-auth-token' ? 'forged-token' : undefined,
      );
      const event = {
        url: new URL(`http://localhost${pathname}`),
        cookies: { get: cookieGet },
        locals: {} as Record<string, unknown>,
      } as unknown as RequestEvent;
      const resolve = vi.fn(async () => new Response('ok'));

      const response = await e2eHandle({ event, resolve } as never);

      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
      // The skip returns before any cookie read or E2E database load.
      expect(cookieGet).not.toHaveBeenCalled();
      expect(event.locals.user).toBeUndefined();
    },
  );
});
