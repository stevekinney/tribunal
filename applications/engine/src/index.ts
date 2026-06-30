import { createHash, timingSafeEqual } from 'node:crypto';
import { NeonStorage } from '@lostgradient/weft/storage/neon';
import type { Storage } from '@lostgradient/weft';
import { createHealthResponse, type EngineHealthDependency } from './health';
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineSingletonLock,
  type ReviewIntentQueueStatus,
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
    reviewIntentPollIntervalMs: environment.REVIEW_INTENT_POLL_INTERVAL_MS,
    allowEphemeralStorageForTests: storageConfiguration.allowEphemeralStorageForTests,
  });
  const reviewIntentKickScheduler = createReviewIntentKickScheduler(runtime, {
    idleShutdownSeconds: environment.ENGINE_IDLE_SHUTDOWN_SECONDS,
  });

  startSandboxReaper(environment.SANDBOX_REAP_INTERVAL, runtime);
  const server = Bun.serve(
    createEngineServerOptions(
      port,
      runtime,
      environment.TRIBUNAL_ENGINE_CONTROL_TOKEN,
      environment.TRIBUNAL_ENGINE_BIND_HOST,
      reviewIntentKickScheduler,
    ),
  );
  reviewIntentKickScheduler.kick();
  console.log(`[engine] listening on ${server.hostname}:${server.port}`);
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
  hostname?: string,
  reviewIntentKickScheduler: ReviewIntentKickScheduler = createReviewIntentKickScheduler(runtime),
) {
  return {
    port,
    ...(hostname === undefined ? {} : { hostname }),
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
      if (url.pathname === '/review-intents/kick' && request.method === 'POST') {
        if (!hasValidControlToken(request, controlToken)) {
          return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        }
        const { started } = reviewIntentKickScheduler.kick();
        return Response.json({ ok: true, started }, { status: 202 });
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

export type ReviewIntentKickScheduler = {
  kick(): { started: boolean };
  stop(): void;
};

export type ReviewIntentKickSchedulerOptions = {
  idleShutdownSeconds?: number;
  drainLimit?: number;
  now?: () => Date;
  exit?: (code: number) => void;
  logger?: Pick<typeof console, 'error' | 'log'>;
  setTimeoutFunction?: typeof setTimeout;
  clearTimeoutFunction?: typeof clearTimeout;
};

export function createReviewIntentKickScheduler(
  runtime: Pick<EngineRuntime, 'drainReviewIntents' | 'getReviewIntentQueueStatus' | 'release'>,
  options: ReviewIntentKickSchedulerOptions = {},
): ReviewIntentKickScheduler {
  const drainLimit = options.drainLimit ?? 5;
  const now = options.now ?? (() => new Date());
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logger = options.logger ?? console;
  const setTimeoutFunction = options.setTimeoutFunction ?? setTimeout;
  const clearTimeoutFunction = options.clearTimeoutFunction ?? clearTimeout;
  const idleShutdownMs =
    options.idleShutdownSeconds === undefined ? undefined : options.idleShutdownSeconds * 1_000;

  let activeDrain: Promise<void> | undefined;
  let idleShutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let kickRequestedDuringDrain = false;
  let released = false;

  const clearIdleShutdownTimer = () => {
    if (idleShutdownTimer === undefined) return;
    clearTimeoutFunction(idleShutdownTimer);
    idleShutdownTimer = undefined;
  };

  const scheduleIdleShutdownCheck = (delayMs: number) => {
    if (idleShutdownMs === undefined || released) return;
    clearIdleShutdownTimer();
    idleShutdownTimer = setTimeoutFunction(() => {
      idleShutdownTimer = undefined;
      void shutdownIfIdle();
    }, delayMs);
    idleShutdownTimer.unref?.();
  };

  const scheduleConfiguredIdleShutdown = () => {
    if (idleShutdownMs === undefined) return;
    scheduleIdleShutdownCheck(idleShutdownMs);
  };

  const startDrain = (): { started: boolean } => {
    if (released) return { started: false };
    clearIdleShutdownTimer();
    if (activeDrain !== undefined) {
      kickRequestedDuringDrain = true;
      return { started: false };
    }

    activeDrain = drainUntilIdle()
      .catch((error) => {
        logger.error('[engine] review intent kick drain failed', error);
      })
      .finally(() => {
        activeDrain = undefined;
        if (kickRequestedDuringDrain) {
          kickRequestedDuringDrain = false;
          startDrain();
          return;
        }
        scheduleConfiguredIdleShutdown();
      });

    return { started: true };
  };

  const hasDeferredWork = (queueStatus: ReviewIntentQueueStatus): boolean => {
    return queueStatus.deferredCount > 0;
  };

  const getDeferredDelay = (queueStatus: ReviewIntentQueueStatus): number => {
    if (idleShutdownMs === undefined) return 0;
    if (queueStatus.nextAttemptAt === undefined) return idleShutdownMs;
    const untilNextAttemptMs = Math.max(
      1_000,
      queueStatus.nextAttemptAt.getTime() - now().getTime(),
    );
    return Math.min(idleShutdownMs, untilNextAttemptMs);
  };

  const shutdownIfIdle = async () => {
    if (released || activeDrain !== undefined) return;

    try {
      const processed = await runtime.drainReviewIntents(drainLimit);
      if (processed > 0) {
        startDrain();
        return;
      }

      const queueStatus = await runtime.getReviewIntentQueueStatus(now());
      if (queueStatus.readyCount > 0) {
        startDrain();
        return;
      }
      if (hasDeferredWork(queueStatus)) {
        scheduleIdleShutdownCheck(getDeferredDelay(queueStatus));
        return;
      }

      released = true;
      await runtime.release();
      logger.log('[engine] idle shutdown complete');
      exit(0);
    } catch (error) {
      logger.error('[engine] idle shutdown check failed', error);
      scheduleConfiguredIdleShutdown();
    }
  };

  const drainUntilIdle = async () => {
    while (!released) {
      const processed = await runtime.drainReviewIntents(drainLimit);
      if (processed === 0) return;
    }
  };

  return {
    kick: startDrain,
    stop() {
      clearIdleShutdownTimer();
    },
  };
}

/**
 * Checks that the incoming `Authorization` header matches the expected control
 * token using a constant-time SHA-256 comparison.
 *
 * This intentionally uses the hash-first Buffer pattern rather than the shared
 * `constantTimeStringEqual` helper from `@tribunal/review-core`. Hashing both
 * strings to fixed-length SHA-256 digests before calling `timingSafeEqual`
 * avoids leaking any information about the token length — a stronger guarantee
 * than the length-mismatch short-circuit in `constantTimeStringEqual`.
 */
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
