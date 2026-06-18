import { createHealthResponse } from './health';
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

  const runtime = await createEngineRuntime({
    reviewIntentConsumer: createReviewIntentConsumerFromEnvironment(
      Bun.env as ReviewIntentRuntimeEnvironment,
    ),
    allowEphemeralStorageForTests:
      Bun.env.TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE === '1' ||
      (Bun.env.NODE_ENV !== 'production' && !Bun.env.WEFT_DATABASE_URL),
  });

  Bun.serve(createEngineServerOptions(port, runtime));
}

export function createEngineServerOptions(port: number, runtime: EngineRuntime) {
  return {
    port,
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return createHealthResponse();
      }
      if (url.pathname === '/review-intents/drain' && request.method === 'POST') {
        const processed = await runtime.drainReviewIntents();
        return Response.json({ ok: true, processed });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}
