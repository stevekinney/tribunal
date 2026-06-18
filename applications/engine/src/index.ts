import { NeonStorage } from '@lostgradient/weft/storage/neon';
import type { Storage } from '@lostgradient/weft';
import { createHealthResponse, type EngineHealthDependency } from './health';
import { createEngineRuntime, type EngineRuntime } from './workflows/bootstrap';
import {
  createReviewIntentConsumerFromEnvironment,
  type ReviewIntentRuntimeEnvironment,
} from './workflows/runtime-ports';

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

if (import.meta.main) {
  const port = parsePort(Bun.env.PORT, 3001);
  const storageConfiguration = createStorageConfigurationFromEnvironment(Bun.env);

  const runtime = await createEngineRuntime({
    storage: storageConfiguration.storage,
    healthDependencies: storageConfiguration.healthDependencies,
    reviewIntentConsumer: createReviewIntentConsumerFromEnvironment(
      Bun.env as ReviewIntentRuntimeEnvironment,
    ),
    allowEphemeralStorageForTests: storageConfiguration.allowEphemeralStorageForTests,
  });

  Bun.serve(
    createEngineServerOptions(
      port,
      runtime,
      requireEnvironmentValue(
        Bun.env.TRIBUNAL_ENGINE_CONTROL_TOKEN,
        'TRIBUNAL_ENGINE_CONTROL_TOKEN',
      ),
    ),
  );
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
      healthDependencies: [
        { name: 'weft_database', ok: true },
        { name: 'singleton_lock', ok: true },
      ],
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
      return new Response('Not found', { status: 404 });
    },
  };
}

function hasValidControlToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get('authorization');
  return authorization === `Bearer ${expectedToken}`;
}

function requireEnvironmentValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
