import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

const e2eSecret = process.env.E2E_TEST_SECRET ?? 'tribunal-e2e-secret';

export type E2ESession = {
  user: { id: number; username: string };
  repository: { id: number; owner: string; name: string };
  workerId: string;
};

export async function createE2ESession(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
): Promise<E2ESession> {
  const workerId = String(testInfo.parallelIndex);
  const resetResponse = await request.post('/__e2e__/reset', {
    headers: e2eHeaders(workerId),
    data: { seed: {} },
  });
  expect(resetResponse.ok()).toBe(true);

  const loginResponse = await page.request.post('/__e2e__/login', {
    headers: e2eHeaders(workerId),
    data: {
      seed: { repository: true },
      user: {
        username: `e2e-user-${workerId}`,
        name: 'E2E Operator',
        email: `operator-${workerId}@test.local`,
      },
    },
  });
  expect(loginResponse.ok()).toBe(true);
  const loginPayload = (await loginResponse.json()) as E2ESession;

  return { ...loginPayload, workerId };
}

export function e2eHeaders(workerId: string): Record<string, string> {
  return {
    'x-e2e-secret': e2eSecret,
    'x-e2e-worker-id': workerId,
  };
}
