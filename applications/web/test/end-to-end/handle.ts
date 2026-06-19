/**
 * E2E Test Handle
 *
 * SvelteKit handle function that intercepts E2E test endpoints (/__e2e__/*).
 * Extracted from hooks.server.ts to keep E2E infrastructure out of production code.
 *
 * This module is always imported (since sequence() needs a reference), but the
 * E2E code paths are gated behind E2E_TEST_MODE and dynamic imports so nothing
 * heavy (PGlite, drizzle-kit) is pulled into production bundles.
 */

import type { Handle, RequestEvent } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
  deleteNeonAuthTokenCookie,
  neonAuthTokenCookieName,
  setNeonAuthTokenCookie,
} from '$lib/server/auth/neon-session';
import { runWithDatabase, type Database } from '$lib/server/database';

// ---------------------------------------------------------------------------
// E2E database module (lazy-loaded to avoid pulling PGlite into production)
// ---------------------------------------------------------------------------

let e2eDatabaseModule: typeof import('./database') | null = null;

async function loadE2EDatabaseModule() {
  if (!e2eDatabaseModule) {
    e2eDatabaseModule = await import('./database');
  }
  return e2eDatabaseModule;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const E2E_SECRET_HEADER = 'x-e2e-secret';
const E2E_WORKER_ID_HEADER = 'x-e2e-worker-id';
const E2E_WORKER_ID_COOKIE = 'e2e-worker-id';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if we're in E2E test mode.
 */
function isE2EMode(): boolean {
  return env.E2E_TEST_MODE === '1';
}

/**
 * Result of parsing a worker ID.
 * Either a valid worker ID string, undefined (no header provided), or an error response.
 */
type WorkerIdResult =
  | { type: 'valid'; workerId: string }
  | { type: 'missing'; workerId: undefined }
  | { type: 'invalid'; error: Response };

/**
 * Validate and parse a worker ID.
 * Worker IDs should be numeric strings (e.g., "0", "1", "2") from Playwright's parallelIndex.
 */
function parseWorkerId(value: string | null | undefined): WorkerIdResult {
  if (!value) return { type: 'missing', workerId: undefined };
  if (!/^\d+$/.test(value)) {
    console.error(`[E2E] Invalid worker ID format: "${value}" (expected numeric string)`);
    return {
      type: 'invalid',
      error: new Response(
        JSON.stringify({
          error: `Invalid worker ID format: "${value}" (expected numeric string like "0", "1", "2")`,
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    };
  }
  return { type: 'valid', workerId: value };
}

/**
 * Extract and validate worker ID from request headers.
 */
function getWorkerIdFromRequest(request: Request): { workerId: string | undefined } | Response {
  const result = parseWorkerId(request.headers.get(E2E_WORKER_ID_HEADER));
  if (result.type === 'invalid') {
    return result.error;
  }
  return { workerId: result.workerId };
}

/**
 * Extract and validate worker ID from cookies.
 * Returns undefined for missing/invalid cookies (graceful fallback for page requests).
 */
function getWorkerIdFromCookie(cookieValue: string | undefined): string | undefined {
  const result = parseWorkerId(cookieValue);
  if (result.type === 'valid') {
    return result.workerId;
  }
  return undefined;
}

/**
 * Create a Set-Cookie header value for the test-only bridge token.
 * Used when returning a custom Response (which bypasses SvelteKit's cookie API).
 */
function createAuthCookieHeader(token: string, expiresAt: Date): string {
  const isE2E = env.E2E_TEST_MODE === '1';
  const parts = [
    `${neonAuthTokenCookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];

  if (!dev && !isE2E) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Create a Set-Cookie header value for the E2E worker ID.
 */
function createWorkerIdCookieHeader(workerId: string): string {
  const parts = [
    `${E2E_WORKER_ID_COOKIE}=${workerId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${30 * 24 * 60 * 60}`,
  ];
  return parts.join('; ');
}

/**
 * Validate E2E request headers (mode + secret).
 */
function validateE2ERequest(request: Request): Response | null {
  if (!isE2EMode()) {
    return new Response('Not Found', { status: 404 });
  }

  const providedSecret = request.headers.get(E2E_SECRET_HEADER);
  const expectedSecret = env.E2E_TEST_SECRET;

  if (!expectedSecret) {
    console.error('[E2E] E2E_TEST_SECRET is not configured');
    return new Response('Server configuration error', { status: 500 });
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null;
}

/**
 * Validate a test-only bridge token against the per-worker E2E database.
 */
async function validateE2EAuthToken(
  token: string,
  workerId: string,
): Promise<{
  neonSession: { neonAuthUserId: string; expiresAt: Date } | null;
  user: {
    id: number;
    username: string;
    name: string | null;
    avatarUrl: string | null;
    email: string | null;
    isPlatformAdministrator: boolean;
  } | null;
}> {
  try {
    const { getE2EDatabase } = await import('$testing/end-to-end/seed');
    const { eq } = await import('drizzle-orm');
    const schema = await import('@tribunal/database/schema');

    const db = await getE2EDatabase(workerId);
    const [, tokenWorkerId, userIdValue] = token.split(':');
    const userId = Number(userIdValue);
    if (!token.startsWith('e2e:') || tokenWorkerId !== workerId || !Number.isInteger(userId)) {
      return { neonSession: null, user: null };
    }

    const [result] = await db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        neonAuthUserId: schema.user.neonAuthUserId,
        name: schema.user.name,
        avatarUrl: schema.user.avatarUrl,
        email: schema.user.email,
        isPlatformAdministrator: schema.user.isPlatformAdministrator,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId));

    if (!result || !result.neonAuthUserId) {
      return { neonSession: null, user: null };
    }

    const { neonAuthUserId, ...user } = result;
    return {
      neonSession: {
        neonAuthUserId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
      user,
    };
  } catch (error) {
    console.error('[E2E Auth Validation] Error:', error);
    return { neonSession: null, user: null };
  }
}

// ---------------------------------------------------------------------------
// E2E endpoint handlers
// ---------------------------------------------------------------------------

async function handleE2ELogin(event: RequestEvent): Promise<Response> {
  const validationError = validateE2ERequest(event.request);
  if (validationError) return validationError;

  try {
    const workerIdResult = getWorkerIdFromRequest(event.request);
    if (workerIdResult instanceof Response) return workerIdResult;
    const { workerId } = workerIdResult;

    const body = await event.request.json();
    const { seed = {}, user: userOptions = {} } = body as {
      seed?: {
        repository?: boolean;
      };
      user?: { username?: string; name?: string; email?: string };
    };

    const { getE2EDatabase, seedE2EUser, seedOperatorData, seedRepository } =
      await import('$testing/end-to-end/seed');

    const db = await getE2EDatabase(workerId);
    const { user, token } = await seedE2EUser(db, userOptions, workerId);

    let repository = null;
    if (seed.repository) {
      const result = await seedRepository(db, {}, workerId);
      repository = result.repository;
    }

    if (repository) {
      await seedOperatorData(db, { userId: user.id, repositoryId: repository.id });
    }

    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    const sessionCookieHeader = createAuthCookieHeader(token, expiresAt);

    const headers = new Headers();
    headers.set('content-type', 'application/json');
    headers.append('set-cookie', sessionCookieHeader);

    if (workerId) {
      headers.append('set-cookie', createWorkerIdCookieHeader(workerId));
    }

    return new Response(
      JSON.stringify({
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
        },
        repository: repository
          ? {
              id: repository.id,
              owner: repository.owner,
              name: repository.name,
              installationId: repository.installationId,
            }
          : null,
      }),
      { status: 200, headers },
    );
  } catch (error) {
    console.error('[E2E Login] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}

async function handleE2EReset(event: RequestEvent): Promise<Response> {
  const validationError = validateE2ERequest(event.request);
  if (validationError) return validationError;

  try {
    const workerIdResult = getWorkerIdFromRequest(event.request);
    if (workerIdResult instanceof Response) return workerIdResult;
    const { workerId } = workerIdResult;

    const body = await event.request.json();
    const { seed = {} } = body as {
      seed?: { user?: boolean; repository?: boolean };
    };

    const { resetE2EDatabase } = await import('$testing/end-to-end/database');
    const { resetSeedCounter, getE2EDatabase, seedE2EUser, seedOperatorData, seedRepository } =
      await import('$testing/end-to-end/seed');

    await resetE2EDatabase(workerId);
    resetSeedCounter(workerId);

    let user = null;
    let repository = null;
    let token = null;

    if (seed.user) {
      const db = await getE2EDatabase(workerId);
      const result = await seedE2EUser(db, {}, workerId);
      user = result.user;
      token = result.token;

      if (seed.repository) {
        const repositoryResult = await seedRepository(db, {}, workerId);
        repository = repositoryResult.repository;
        await seedOperatorData(db, { userId: user.id, repositoryId: repository.id });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: user
          ? {
              id: user.id,
              username: user.username,
              name: user.name,
              email: user.email,
              avatarUrl: user.avatarUrl,
            }
          : null,
        repository: repository
          ? {
              id: repository.id,
              owner: repository.owner,
              name: repository.name,
              installationId: repository.installationId,
            }
          : null,
        token,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (error) {
    console.error('[E2E Reset] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}

async function handleE2EReviewLifecycle(event: RequestEvent): Promise<Response> {
  const validationError = validateE2ERequest(event.request);
  if (validationError) return validationError;

  try {
    const workerIdResult = getWorkerIdFromRequest(event.request);
    if (workerIdResult instanceof Response) return workerIdResult;
    const { workerId } = workerIdResult;

    const body = (await event.request.json()) as {
      userId?: number;
      repositoryId?: number;
      pullRequestNumber?: number;
      headSha?: string;
      deliveryId?: string;
      kind?: 'opened' | 'synchronize' | 'closed' | 'redelivered';
    };

    if (!Number.isInteger(body.userId) || !Number.isInteger(body.repositoryId)) {
      return new Response(JSON.stringify({ error: 'userId and repositoryId are required.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const userId = Number(body.userId);
    const repositoryId = Number(body.repositoryId);
    if (
      body.kind !== undefined &&
      body.kind !== 'opened' &&
      body.kind !== 'synchronize' &&
      body.kind !== 'closed' &&
      body.kind !== 'redelivered'
    ) {
      return new Response(
        JSON.stringify({
          error: 'kind must be opened, synchronize, closed, or redelivered when provided.',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }

    const { applyFakeReviewLifecycleEvent, canUserAccessE2ERepository, getE2EDatabase } =
      await import('$testing/end-to-end/seed');
    const db = await getE2EDatabase(workerId);
    const canAccessRepository = await canUserAccessE2ERepository(db, { userId, repositoryId });
    if (!canAccessRepository) {
      return new Response(JSON.stringify({ error: 'Repository is not available to this user.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const result = await applyFakeReviewLifecycleEvent(db, {
      userId,
      repositoryId,
      pullRequestNumber: body.pullRequestNumber,
      headSha: body.headSha,
      deliveryId: body.deliveryId,
      kind: body.kind,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('[E2E Review Lifecycle] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}

// ---------------------------------------------------------------------------
// Exported handle
// ---------------------------------------------------------------------------

/**
 * E2E handle — intercepts /__e2e__/* endpoints and wraps session validation
 * with per-worker database isolation.
 *
 * In production (E2E_TEST_MODE !== '1') this is a trivial pass-through that
 * calls resolve(event) immediately, adding no overhead.
 */
export const e2eHandle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (!isE2EMode()) {
    // Fast path: not E2E, just resolve immediately.
    // If someone hits /__e2e__/* in prod, the auth handle will 404 naturally
    // or they'll get a normal page render — no special treatment needed.
    return resolve(event);
  }

  // During `vite build`, SvelteKit prerenders static pages. These don't need
  // database access or E2E infrastructure — skip everything.
  if (building) {
    return resolve(event);
  }

  // Ensure E2E database module is loaded early so getE2EDatabaseInstanceSync
  // is available for synchronous access in wrapResolveWithDatabase.
  await loadE2EDatabaseModule();

  // Route E2E endpoints
  if (pathname.startsWith('/__e2e__/')) {
    if (event.request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }

    switch (pathname) {
      case '/__e2e__/login':
        return handleE2ELogin(event);
      case '/__e2e__/reset':
        return handleE2EReset(event);
      case '/__e2e__/review-lifecycle':
        return handleE2EReviewLifecycle(event);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  // For non-endpoint requests in E2E mode, handle per-worker auth validation.
  const neonAuthToken = event.cookies.get(neonAuthTokenCookieName);
  const e2eWorkerId = getWorkerIdFromCookie(event.cookies.get(E2E_WORKER_ID_COOKIE));

  if (!neonAuthToken) {
    event.locals.user = null;
    event.locals.neonSession = null;
    return wrapResolveWithDatabase(event, resolve, e2eWorkerId);
  }

  let neonSession, user;

  if (e2eWorkerId) {
    const result = await validateE2EAuthToken(neonAuthToken, e2eWorkerId);
    neonSession = result.neonSession;
    user = result.user;
  } else {
    console.warn(
      '[E2E] Auth token present but worker ID cookie missing/invalid. Treating as invalid session.',
    );
    neonSession = null;
    user = null;
  }

  if (neonSession) {
    setNeonAuthTokenCookie(event, neonAuthToken, neonSession.expiresAt);
  } else {
    deleteNeonAuthTokenCookie(event);
  }

  event.locals.user = user;
  event.locals.neonSession = neonSession;

  return wrapResolveWithDatabase(event, resolve, e2eWorkerId);
};

/**
 * Wrap resolve with a per-worker PGlite database override when a worker ID
 * is available. This injects the E2E database into AsyncLocalStorage so the
 * `db` proxy in `$lib/server/database` returns the PGlite instance for the
 * duration of the request.
 *
 * If no worker ID is available (e.g. Playwright health-check requests before
 * login, or pre-login page loads), the request proceeds without database
 * isolation. These requests don't access the database; actual test requests
 * will have the cookie because `/__e2e__/login` sets it.
 */
function wrapResolveWithDatabase(
  event: RequestEvent,
  resolve: (event: RequestEvent) => ReturnType<Handle>,
  workerId?: string,
): ReturnType<Handle> {
  if (!workerId || !e2eDatabaseModule) {
    // No worker ID — proceed without PGlite isolation. This happens for
    // Playwright's server readiness polling and pre-login page loads.
    // If the page actually queries the database, it will hit DATABASE_URL
    // (a placeholder in CI), which is acceptable for non-test requests.
    return resolve(event);
  }

  const pgliteDatabase = e2eDatabaseModule.getE2EDatabaseInstanceSync(workerId);
  return runWithDatabase(pgliteDatabase as Database, () => resolve(event));
}
