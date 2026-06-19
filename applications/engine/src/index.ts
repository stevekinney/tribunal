import { createHash, timingSafeEqual } from 'node:crypto';
import { NeonStorage } from '@lostgradient/weft/storage/neon';
import type { Storage } from '@lostgradient/weft';
import { createHealthResponse, type EngineHealthDependency } from './health';
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineSingletonLock,
} from './workflows/bootstrap';
import { createPostgresAdvisoryLock } from './workflows/postgres-advisory-lock';
import { createReviewIntentConsumerFromEnvironment } from './workflows/runtime-ports';
import { parseEngineEnvironment } from './environment';

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

if (import.meta.main) {
  const port = parsePort(Bun.env.PORT, 3001);
  const environment = parseEngineEnvironment(Bun.env);
  const storageConfiguration = createStorageConfigurationFromEnvironment(environment);

  const runtime = await createEngineRuntime({
    storage: storageConfiguration.storage,
    lock: storageConfiguration.lock,
    healthDependencies: storageConfiguration.healthDependencies,
    reviewIntentConsumer: createReviewIntentConsumerFromEnvironment(environment),
    allowEphemeralStorageForTests: storageConfiguration.allowEphemeralStorageForTests,
  });

  startSandboxReaper(environment.SANDBOX_REAP_INTERVAL, runtime);
  Bun.serve(createEngineServerOptions(port, runtime, environment.TRIBUNAL_ENGINE_CONTROL_TOKEN));
}

export function startSandboxReaper(
  intervalSeconds: number,
  runtime: Pick<EngineRuntime, 'reapClosedPullRequestSandboxes'>,
  setIntervalFunction: typeof setInterval = setInterval,
): ReturnType<typeof setInterval> | undefined {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return undefined;

  const timer = setIntervalFunction(() => {
    void runtime.reapClosedPullRequestSandboxes().catch((error) => {
      console.error('[engine] sandbox reaper failed', error);
    });
  }, intervalSeconds * 1_000);
  timer.unref?.();
  return timer;
}

export function createStorageConfigurationFromEnvironment(environment: {
  NODE_ENV?: string;
  TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE?: string | boolean;
  WEFT_DATABASE_URL?: string;
}): {
  storage: Storage | undefined;
  lock?: EngineSingletonLock;
  allowEphemeralStorageForTests: boolean;
  healthDependencies: EngineHealthDependency[];
} {
  if (environment.WEFT_DATABASE_URL) {
    return {
      storage: new NeonStorage({ url: environment.WEFT_DATABASE_URL }),
      lock: createPostgresAdvisoryLock(environment.WEFT_DATABASE_URL),
      allowEphemeralStorageForTests: false,
      healthDependencies: [
        { name: 'weft_database', ok: true },
        { name: 'singleton_lock', ok: true, detail: 'Postgres advisory lock held' },
      ],
    };
  }

  const allowEphemeralStorageForTests =
    environment.TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE === true ||
    environment.TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE === '1' ||
    environment.NODE_ENV !== 'production';

  return {
    storage: undefined,
    allowEphemeralStorageForTests,
    healthDependencies: [
      {
        name: 'weft_database',
        ok: allowEphemeralStorageForTests,
        detail: allowEphemeralStorageForTests
          ? 'ephemeral storage enabled'
          : 'WEFT_DATABASE_URL is not configured',
      },
      {
        name: 'singleton_lock',
        ok: allowEphemeralStorageForTests,
        detail: allowEphemeralStorageForTests
          ? 'single-process ephemeral runtime'
          : 'durable storage is required before singleton ownership can be acquired',
      },
    ],
  };
}

export function createEngineServerOptions(
  port: number,
  runtime: EngineRuntime,
  controlToken: string,
) {
  return {
    port,
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return createHealthResponse({ dependencies: runtime.healthDependencies() });
      }
      if (url.pathname === '/review-intents/drain' && request.method === 'POST') {
        if (!hasValidControlToken(request, controlToken)) {
          return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        }
        const processed = await runtime.drainReviewIntents();
        return Response.json({ ok: true, processed });
      }
      const stopMatch = /^\/review-runs\/([^/]+)\/stop$/.exec(url.pathname);
      if (stopMatch !== null && request.method === 'POST') {
        if (!hasValidControlToken(request, controlToken)) {
          return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        }
        const result = await runtime.stopReviewRun(decodeURIComponent(stopMatch[1]!));
        if (!result.stopped) {
          return Response.json({ ok: false, error: 'review_run_not_active' }, { status: 404 });
        }
        return Response.json({ ok: true, stopped: true });
      }
      const agentStopMatch = /^\/review-runs\/([^/]+)\/agents\/([^/]+)\/stop$/.exec(url.pathname);
      if (agentStopMatch !== null && request.method === 'POST') {
        if (!hasValidControlToken(request, controlToken)) {
          return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        }
        const result = await runtime.stopReviewAgent(
          decodeURIComponent(agentStopMatch[1]!),
          decodeURIComponent(agentStopMatch[2]!),
        );
        if (!result.stopped) {
          return Response.json({ ok: false, error: 'agent_run_not_active' }, { status: 404 });
        }
        return Response.json({ ok: true, stopped: true });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

function hasValidControlToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get('authorization');
  const expectedAuthorization = `Bearer ${expectedToken}`;
  return (
    authorization !== null &&
    timingSafeEqual(hashControlToken(authorization), hashControlToken(expectedAuthorization))
  );
}

function hashControlToken(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
