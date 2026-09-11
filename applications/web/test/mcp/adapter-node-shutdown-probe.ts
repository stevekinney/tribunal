/**
 * Bun-only probe for TRI-51 AC3. Production runs the built server as
 * `bun build/index.js`, so the empirical questions must be answered under
 * **Bun's** `node:http`, not the Node runtime the Vitest suite uses. It models
 * Tribunal's two-phase graceful shutdown — including the bounded grace window —
 * over a real `node:http` server and proves all three properties:
 *
 *  1. **Ordinary in-flight requests drain.** A slow request already in flight
 *     when shutdown begins completes before `server.close()`'s callback
 *     (adapter-node's `sveltekit:shutdown` emit point) fires — so Bun's
 *     `http.Server.close()` waits for in-flight requests the way Node's does,
 *     and no custom tracking is needed (unlike `Bun.serve().stop(false)`).
 *  2. **Long-lived streams close pre-drain, not by force.** A never-ending
 *     `subscriptions/listen`-style stream is ended by the transport-shutdown step
 *     (the probe's stand-in for `handler.close()` → `cache.closeAll`), so the
 *     drain finishes promptly instead of hanging to the `SHUTDOWN_TIMEOUT`
 *     force-close. The probe asserts the force-close path never runs.
 *  3. **The grace window protects ordinary calls from the abort.** Transport
 *     shutdown models `handler.close()` faithfully: it closes listen streams AND
 *     aborts any ordinary request still in flight (the library's `handler.close`
 *     rejects in-flight exchanges via `inflight`). Because the transport close is
 *     deferred by a grace window while adapter-node's concurrent drain runs, the
 *     ordinary request finishes first and is never aborted. With no grace it
 *     would be destroyed mid-flight — so this is a positive control that fails if
 *     the grace is removed.
 *
 * The client uses `http.get` with `agent: false` (no keep-alive) rather than
 * `fetch`: undici ignores `Connection: close`, so a keep-alive connection could
 * leave `server.close()` pending and make the timing indirect.
 */
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const ORDINARY_DELAY_MS = 300;
const SHUTDOWN_AFTER_MS = 50;
const GRACE_MS = 500; // > ORDINARY_DELAY_MS, so the ordinary call drains within the grace
const FORCE_CLOSE_MS = 5_000;
const OVERALL_TIMEOUT_MS = 8_000;

function report(result: Record<string, unknown>, code: number): never {
  console.log(JSON.stringify(result));
  process.exit(code);
}

/** Reads a response body to completion; resolves ended:false if the connection errors/aborts. */
function readToEnd(url: string): Promise<{ ended: boolean; body: string }> {
  return new Promise((resolve) => {
    get(url, { agent: false }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ ended: true, body }));
      response.on('error', () => resolve({ ended: false, body }));
      response.on('aborted', () => resolve({ ended: false, body }));
    }).on('error', () => resolve({ ended: false, body: '' }));
  });
}

async function main(): Promise<void> {
  let streamResponse: ServerResponse | undefined;
  let ordinaryResponse: ServerResponse | undefined; // set while in flight, cleared on completion
  let ordinaryCompletedAt = 0;
  let shutdownStartedAt = 0;
  let transportShutdownAt = 0;
  let shutdownEmittedAt = 0;
  let forceCloseFired = false;
  let shuttingDown = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  let resolveClose: () => void = () => {};
  const closeEmitted = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.on('close', () => {
      if (shuttingDown) server.closeIdleConnections();
    });

    if (request.url === '/stream') {
      // A long-lived listen-style stream: send one event and never end on its own.
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: open\n\n');
      streamResponse = response;
      return;
    }

    // An ordinary slow request already in flight when shutdown begins.
    ordinaryResponse = response;
    setTimeout(() => {
      ordinaryCompletedAt = Date.now();
      ordinaryResponse = undefined;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    }, ORDINARY_DELAY_MS);
  });

  function transportShutdown(): void {
    transportShutdownAt = Date.now();
    // Faithful to the library's handler.close(): end listen streams AND abort any
    // ordinary request still in flight. The grace window is what ensures a
    // short call has already completed (ordinaryResponse cleared) by now.
    streamResponse?.end();
    ordinaryResponse?.destroy();
  }

  function beginGracefulShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownStartedAt = Date.now();
    // adapter-node's graceful_shutdown drains concurrently from here:
    server.closeIdleConnections();
    server.close(() => {
      if (graceTimer) clearTimeout(graceTimer);
      if (forceTimer) clearTimeout(forceTimer);
      shutdownEmittedAt = Date.now();
      resolveClose();
    });
    // Bounded grace before the transport close (phase 1 of hooks.server.ts):
    graceTimer = setTimeout(transportShutdown, GRACE_MS);
    forceTimer = setTimeout(() => {
      forceCloseFired = true;
      server.closeAllConnections();
    }, FORCE_CLOSE_MS);
    forceTimer.unref?.();
  }

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

  const ordinaryDone = readToEnd(`http://127.0.0.1:${port}/ordinary`);
  const streamDone = readToEnd(`http://127.0.0.1:${port}/stream`);

  setTimeout(beginGracefulShutdown, SHUTDOWN_AFTER_MS);

  const ordinary = await ordinaryDone;
  const stream = await streamDone;
  await closeEmitted;

  const drainMs = shutdownEmittedAt - shutdownStartedAt;
  const graceWaited = transportShutdownAt - shutdownStartedAt;
  const ok =
    ordinary.ended &&
    ordinary.body === 'ok' && // the ordinary call drained, was NOT aborted
    ordinaryCompletedAt > 0 &&
    ordinaryCompletedAt <= transportShutdownAt && // it finished before the transport close
    graceWaited >= GRACE_MS && // the grace window was actually waited
    stream.ended && // the long-lived stream closed gracefully (client saw end, not reset)
    !forceCloseFired && // the force-close path never ran
    drainMs < FORCE_CLOSE_MS;
  report(
    {
      ordinaryDrained: ordinary.ended && ordinary.body === 'ok',
      streamClosedGracefully: stream.ended,
      graceProtectedOrdinary: ordinaryCompletedAt > 0 && ordinaryCompletedAt <= transportShutdownAt,
      forceCloseFired,
      drainMs,
      ok,
    },
    ok ? 0 : 1,
  );
}

const overall = setTimeout(() => report({ timedOut: true }, 1), OVERALL_TIMEOUT_MS);
overall.unref?.();

main().catch((error) =>
  report({ error: error instanceof Error ? error.message : String(error) }, 1),
);
