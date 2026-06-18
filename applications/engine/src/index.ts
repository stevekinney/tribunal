import { timingSafeEqual } from 'node:crypto';
import { NeonStorage } from '@lostgradient/weft/storage/neon';
import type { Storage } from '@lostgradient/weft';
import { createHealthResponse, type EngineHealthDependency } from './health';
import { createEngineRuntime, type EngineRuntime } from './workflows/bootstrap';
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
    healthDependencies: storageConfiguration.healthDependencies,
    reviewIntentConsumer: createReviewIntentConsumerFromEnvironment(environment),
    allowEphemeralStorageForTests: storageConfiguration.allowEphemeralStorageForTests,
  });

  Bun.serve(createEngineServerOptions(port, runtime, environment.TRIBUNAL_ENGINE_CONTROL_TOKEN));
}

export function createStorageConfigurationFromEnvironment(environment: {
  NODE_ENV?: string;
  TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE?: string;
  WEFT_DATABASE_URL?: string;
}): {
  storage: Storage | undefined;
  allowEphemeralStorageForTests: boolean;
  healthDependencies: EngineHealthDependency[];
} {
  if (environment.WEFT_DATABASE_URL) {
    return {
      storage: new NeonStorage({ url: environment.WEFT_DATABASE_URL }),
      allowEphemeralStorageForTests: false,
      healthDependencies: [{ name: 'weft_database', ok: true }],
    };
  }

  const allowEphemeralStorageForTests =
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
      return new Response('Not found', { status: 404 });
    },
  };
}

function hasValidControlToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get('authorization');
  const expectedAuthorization = `Bearer ${expectedToken}`;
  if (authorization === null || authorization.length !== expectedAuthorization.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expectedAuthorization));
}

function requireEnvironmentValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
