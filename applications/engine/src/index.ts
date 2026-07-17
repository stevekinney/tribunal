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

  const server = Bun.serve(
    createStartingEngineServerOptions(
      port,
      environment.TRIBUNAL_ENGINE_CONTROL_TOKEN,
      environment.TRIBUNAL_ENGINE_BIND_HOST,
    ),
  );
  console.log(`[engine] listening on ${server.hostname}:${server.port}; starting runtime`);

  const runtime = await createEngineRuntime({
    storage: storageConfiguration.storage,
    lock: storageConfiguration.lock,
    healthDependencies: storageConfiguration.healthDependencies,
    reviewIntentConsumer: createReviewIntentConsumerFromEnvironment(environment),
    reviewIntentPollIntervalMs: environment.REVIEW_INTENT_POLL_INTERVAL_MS,
    allowEphemeralStorageForTests: storageConfiguration.allowEphemeralStorageForTests,
  });
  let activeSandboxReaperRuns = 0;
  const reviewIntentKickScheduler = createReviewIntentKickScheduler(runtime, {
    idleShutdownSeconds: environment.ENGINE_IDLE_SHUTDOWN_SECONDS,
    isBackgroundWorkActive: () => activeSandboxReaperRuns > 0,
  });

  const sandboxReaperTimer = startSandboxReaper(
    environment.SANDBOX_REAP_INTERVAL,
    runtime,
    setInterval,
    {
      onRunStart: () => {
        activeSandboxReaperRuns += 1;
      },
      onRunComplete: () => {
        activeSandboxReaperRuns = Math.max(0, activeSandboxReaperRuns - 1);
      },
    },
  );
  server.reload(
    createEngineServerOptions(
      port,
      runtime,
      environment.TRIBUNAL_ENGINE_CONTROL_TOKEN,
      environment.TRIBUNAL_ENGINE_BIND_HOST,
      reviewIntentKickScheduler,
    ),
  );
  reviewIntentKickScheduler.kick();

  // Release the Weft singleton lease promptly when Fly sends SIGTERM during a
  // rolling deploy, so the replacement instance acquires ownership immediately
  // instead of waiting out the lease TTL (~30s of "engine runtime is starting").
  const handleShutdownSignal = createSignalShutdown({
    runtime,
    scheduler: reviewIntentKickScheduler,
    server,
    sandboxReaperTimer,
  });
  // `on`, not `once`: the handler is internally idempotent, and keeping the
  // listener registered means a repeated SIGTERM cannot fall through to the
  // default (immediate-termination) behavior and abort an in-progress release.
  process.on('SIGTERM', () => void handleShutdownSignal());
  process.on('SIGINT', () => void handleShutdownSignal());

  console.log('[engine] runtime ready');
}

export function createStartingEngineServerOptions(
  port: number,
  controlToken: string,
  hostname?: string,
) {
  return {
    port,
    ...(hostname === undefined ? {} : { hostname }),
    fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return createHealthResponse({
          dependencies: [
            { name: 'weft_database', ok: false, detail: 'engine runtime is starting' },
            { name: 'singleton_lock', ok: false, detail: 'engine runtime is starting' },
          ],
        });
      }
      if (!hasValidControlToken(request, controlToken)) {
        return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      return Response.json({ ok: false, error: 'engine_starting' }, { status: 503 });
    },
  };
}

export function startSandboxReaper(
  intervalSeconds: number,
  runtime: Pick<EngineRuntime, 'reapClosedPullRequestSandboxes'>,
  setIntervalFunction: typeof setInterval = setInterval,
  hooks: SandboxReaperHooks = {},
): ReturnType<typeof setInterval> | undefined {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return undefined;

  const timer = setIntervalFunction(() => {
    hooks.onRunStart?.();
    void Promise.resolve()
      .then(() => runtime.reapClosedPullRequestSandboxes())
      .catch((error) => {
        console.error('[engine] sandbox reaper failed', error);
      })
      .finally(() => {
        hooks.onRunComplete?.();
      });
  }, intervalSeconds * 1_000);
  timer.unref?.();
  return timer;
}

export type SandboxReaperHooks = {
  onRunStart?: () => void;
  onRunComplete?: () => void;
};

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
        const result = reviewIntentKickScheduler.kick();
        if (!result.started && result.reason === 'released') {
          return Response.json({ ok: false, error: 'engine_released' }, { status: 503 });
        }
        return Response.json({ ok: true, started: result.started }, { status: 202 });
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
  kick(): ReviewIntentKickResult;
  stop(): void;
};

export type ReviewIntentKickResult =
  | { started: true }
  | { started: false; reason: 'already_running' | 'released' };

export type ReviewIntentKickSchedulerOptions = {
  idleShutdownSeconds?: number;
  drainLimit?: number;
  now?: () => Date;
  exit?: (code: number) => void;
  logger?: Pick<typeof console, 'error' | 'log'>;
  setTimeoutFunction?: typeof setTimeout;
  clearTimeoutFunction?: typeof clearTimeout;
  isBackgroundWorkActive?: () => boolean;
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
  const isBackgroundWorkActive = options.isBackgroundWorkActive ?? (() => false);
  const idleShutdownMs =
    options.idleShutdownSeconds === undefined ? undefined : options.idleShutdownSeconds * 1_000;

  let activeDrain: Promise<void> | undefined;
  let drainGeneration = 0;
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

  const startDrain = (): ReviewIntentKickResult => {
    if (released) return { started: false, reason: 'released' };
    clearIdleShutdownTimer();
    if (activeDrain !== undefined) {
      kickRequestedDuringDrain = true;
      return { started: false, reason: 'already_running' };
    }

    drainGeneration += 1;
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

  const hasClaimedWork = (queueStatus: ReviewIntentQueueStatus): boolean => {
    return queueStatus.claimedCount > 0;
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
    const observedDrainGeneration = drainGeneration;
    const hasNewDrainActivity = () =>
      activeDrain !== undefined || drainGeneration !== observedDrainGeneration;

    try {
      const processed = await runtime.drainReviewIntents(drainLimit);
      if (hasNewDrainActivity()) return;
      if (processed > 0) {
        startDrain();
        return;
      }

      const queueStatus = await runtime.getReviewIntentQueueStatus(now());
      if (hasNewDrainActivity()) return;
      if (queueStatus.readyCount > 0) {
        startDrain();
        return;
      }
      if (hasDeferredWork(queueStatus)) {
        scheduleIdleShutdownCheck(getDeferredDelay(queueStatus));
        return;
      }
      if (hasClaimedWork(queueStatus) || isBackgroundWorkActive()) {
        scheduleConfiguredIdleShutdown();
        return;
      }

      released = true;
      await runtime.release();
      logger.log('[engine] idle shutdown complete');
      exit(0);
    } catch (error) {
      released = false;
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
      // Quiesce the drain so no new review intents are claimed during shutdown:
      // setting `released` makes `drainUntilIdle` exit after its current batch
      // and `startDrain` refuse further drains. Intents already claimed by the
      // in-flight batch are durable and re-claimable by the next engine.
      released = true;
      clearIdleShutdownTimer();
    },
  };
}

export type SignalShutdownInput = {
  runtime: Pick<EngineRuntime, 'release'>;
  scheduler: Pick<ReviewIntentKickScheduler, 'stop'>;
  server: { stop: (closeActiveConnections?: boolean) => Promise<void> | void };
  sandboxReaperTimer?: ReturnType<typeof setInterval>;
  logger?: Pick<Console, 'log' | 'error'>;
  exit?: (code: number) => void;
  clearIntervalFunction?: (timer: ReturnType<typeof setInterval>) => void;
  releaseAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const DEFAULT_RELEASE_ATTEMPTS = 3;
const RELEASE_RETRY_DELAY_MS = 500;

/**
 * Builds an idempotent handler for process termination signals (SIGTERM/SIGINT).
 *
 * On a Fly rolling deploy the outgoing engine receives SIGTERM. Releasing the
 * Weft ownership lease promptly — `runtime.release()` disposes the engine and
 * deletes the lease record — lets the replacement instance acquire ownership
 * immediately instead of waiting out the lease TTL. That is the difference
 * between a ~1s and a ~30s "engine runtime is starting" window on every deploy.
 * Relies on Weft's async-release contract (see stevekinney/weft#630); a bare
 * `process.exit` would silently degrade the handoff to TTL-bounded.
 *
 * Releasing while work is in flight is safe by design and does NOT mirror the
 * idle-shutdown path's "defer while busy" guard. Weft's `asyncDispose` drains
 * queued workflow starts before releasing, durable checkpoints let the
 * replacement instance resume in-flight executions, and lease-epoch fencing
 * rejects any stale write from this instance. SIGTERM is a hard deadline
 * (Fly escalates to SIGKILL after `kill_timeout`), so waiting for claimed
 * review intents or sandbox reaps to finish would risk skipping the release
 * entirely — reintroducing the TTL-bound handoff this exists to prevent. A
 * concurrent idle-shutdown exit is harmless: `release()` is idempotent and a
 * second `process.exit` is a no-op.
 */
export function createSignalShutdown(input: SignalShutdownInput): () => Promise<void> {
  const logger = input.logger ?? console;
  const exit = input.exit ?? ((code: number) => process.exit(code));
  const clearIntervalFunction = input.clearIntervalFunction ?? clearInterval;
  const releaseAttempts = input.releaseAttempts ?? DEFAULT_RELEASE_ATTEMPTS;
  const sleep =
    input.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let shuttingDown = false;

  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.log('[engine] shutdown signal received; releasing singleton lease');

    // Stop accepting new work first, but never let a failure here skip the
    // lease release below — that release is the whole point of the handler.
    // Force active connections closed (`stop(true)`): a lease handoff must not
    // be held hostage by an in-flight control/health request that could consume
    // the whole kill_timeout before release() ever runs.
    try {
      input.scheduler.stop();
      if (input.sandboxReaperTimer !== undefined) clearIntervalFunction(input.sandboxReaperTimer);
      await input.server.stop(true);
    } catch (error) {
      logger.error('[engine] stopping intake failed during shutdown', error);
    }

    // Retry the release within the shutdown window (bounded by kill_timeout).
    // release() is retryable — it clears its in-flight promise on failure — and
    // a prompt lease handoff, not a fall back to the lease TTL, is the whole
    // point of this handler.
    for (let attempt = 1; attempt <= releaseAttempts; attempt += 1) {
      try {
        await input.runtime.release();
        break;
      } catch (error) {
        logger.error(
          `[engine] lease release attempt ${attempt}/${releaseAttempts} failed during shutdown`,
          error,
        );
        if (attempt < releaseAttempts) await sleep(RELEASE_RETRY_DELAY_MS);
      }
    }

    logger.log('[engine] shutdown complete');
    exit(0);
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
