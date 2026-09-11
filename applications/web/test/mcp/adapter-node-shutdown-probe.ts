/**
 * Bun-only probe for TRI-51 AC3. Production runs the built server as
 * `bun build/index.js`, so the empirical question — does graceful shutdown wait
 * for in-flight requests, or is custom tracking needed as it was for
 * `Bun.serve().stop(false)`? — must be answered under **Bun's** `node:http`, not
 * the Node runtime the Vitest suite uses. This replicates adapter-node's exact
 * `graceful_shutdown` sequence (`@sveltejs/adapter-node/files/index.js`):
 * `closeIdleConnections()`, then `close(callback)` where the callback is the
 * `process.emit('sveltekit:shutdown')` point, plus a `SHUTDOWN_TIMEOUT`-style
 * force-close timer and the per-request idle-close adapter-node performs so a
 * keep-alive connection does not hold `close()` open forever.
 *
 * It opens a slow in-flight request, triggers shutdown mid-request, and succeeds
 * (exit 0) only if the request completes before the close callback fires — i.e.
 * the callback waited for the in-flight handler, so no custom tracking is needed
 * under Bun (unlike `Bun.serve().stop(false)`). The spawning Vitest test
 * (`adapter-node-shutdown.verify.test.ts`) asserts the exit code and output.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const HANDLER_DELAY_MS = 300;
const FORCE_CLOSE_MS = 5_000;
const OVERALL_TIMEOUT_MS = 8_000;

function report(result: Record<string, unknown>, code: number): never {
  console.log(JSON.stringify(result));
  process.exit(code);
}

async function main(): Promise<void> {
  let requestStarted = false;
  let requestCompleted = false;
  let requestCompletedAt = 0;
  let shuttingDown = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  let resolveClose: (emittedAt: number) => void;
  const closeEmittedAt = new Promise<number>((resolve) => {
    resolveClose = resolve;
  });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requestStarted = true;

    // Mirror adapter-node: while shutting down, close connections as they go idle
    // so a keep-alive connection does not keep `close()`'s callback pending.
    request.on('close', () => {
      if (shuttingDown) server.closeIdleConnections();
    });

    // A signal arrives mid-request: begin graceful shutdown now, then let the
    // handler finish its work after a delay.
    beginGracefulShutdown();

    setTimeout(() => {
      requestCompleted = true;
      requestCompletedAt = Date.now();
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    }, HANDLER_DELAY_MS);
  });

  function beginGracefulShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    // adapter-node's graceful_shutdown, verbatim in shape:
    server.closeIdleConnections();
    server.close(() => {
      if (forceTimer) clearTimeout(forceTimer);
      resolveClose(Date.now());
    });
    forceTimer = setTimeout(() => server.closeAllConnections(), FORCE_CLOSE_MS);
    forceTimer.unref?.();
  }

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

  const responseText = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
  const shutdownEmittedAt = await closeEmittedAt;

  // The core empirical assertion: the close callback (the sveltekit:shutdown emit
  // point) fired only after the in-flight handler completed.
  const shutdownWaitedForInFlight =
    requestStarted && requestCompleted && shutdownEmittedAt >= requestCompletedAt;
  const ok = shutdownWaitedForInFlight && responseText === 'ok';
  report(
    { requestStarted, requestCompleted, shutdownWaitedForInFlight, responseText, ok },
    ok ? 0 : 1,
  );
}

const overall = setTimeout(() => report({ timedOut: true }, 1), OVERALL_TIMEOUT_MS);
overall.unref?.();

main().catch((error) =>
  report({ error: error instanceof Error ? error.message : String(error) }, 1),
);
