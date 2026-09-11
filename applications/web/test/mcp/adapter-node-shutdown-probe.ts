/**
 * Bun-only probe for TRI-51 AC3. Production runs the built server as
 * `bun build/index.js`, so the empirical questions must be answered under
 * **Bun's** `node:http`, not the Node runtime the Vitest suite uses. It models
 * Tribunal's two-phase graceful shutdown over a real `node:http` server and
 * proves both halves:
 *
 *  1. **Ordinary in-flight requests drain.** A slow request already in flight
 *     when shutdown begins still completes before `server.close()`'s callback
 *     (adapter-node's `sveltekit:shutdown` emit point) fires — so Bun's
 *     `http.Server.close()` waits for in-flight requests the way Node's does,
 *     and no custom tracking is needed (unlike `Bun.serve().stop(false)`).
 *  2. **Long-lived streams close pre-drain, not by force.** A never-ending
 *     `subscriptions/listen`-style stream is closed by a pre-drain
 *     `transportShutdown()` hook — the probe's stand-in for the mount's
 *     `cache.closeAll()` — so the drain completes promptly and gracefully
 *     instead of hanging until the `SHUTDOWN_TIMEOUT` force-close. The probe
 *     asserts the force-close path never runs.
 *
 * The client uses `http.get` with `agent: false` (no keep-alive) rather than
 * `fetch`: undici ignores `Connection: close`, so a keep-alive connection could
 * leave `server.close()` pending and make the timing indirect.
 */
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const ORDINARY_DELAY_MS = 300;
const SHUTDOWN_AFTER_MS = 50;
const FORCE_CLOSE_MS = 5_000;
const OVERALL_TIMEOUT_MS = 8_000;

function report(result: Record<string, unknown>, code: number): never {
  console.log(JSON.stringify(result));
  process.exit(code);
}

/** Reads a response body to completion; resolves false if the connection errors/aborts. */
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
  let ordinaryCompletedAt = 0;
  let shutdownStartedAt = 0;
  let shutdownEmittedAt = 0;
  let forceCloseFired = false;
  let shuttingDown = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  let resolveClose: () => void = () => {};
  const closeEmitted = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Mirror adapter-node: during shutdown, close connections as they go idle so
    // a keep-alive connection cannot hold close() pending. (The non-keep-alive
    // client above makes this unnecessary here, but it keeps the probe faithful.)
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
    setTimeout(() => {
      ordinaryCompletedAt = Date.now();
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    }, ORDINARY_DELAY_MS);
  });

  function transportShutdown(): void {
    // Phase 1 stand-in for the mount's cache.closeAll(): gracefully end the
    // long-lived stream so it does not hold the drain open to the force timer.
    streamResponse?.end();
  }

  function beginGracefulShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownStartedAt = Date.now();
    transportShutdown(); // pre-drain
    // adapter-node's graceful_shutdown sequence:
    server.closeIdleConnections();
    server.close(() => {
      if (forceTimer) clearTimeout(forceTimer);
      shutdownEmittedAt = Date.now();
      resolveClose();
    });
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

  // Begin shutdown once both requests are in flight.
  setTimeout(beginGracefulShutdown, SHUTDOWN_AFTER_MS);

  const ordinary = await ordinaryDone;
  const stream = await streamDone;
  await closeEmitted;

  const drainMs = shutdownEmittedAt - shutdownStartedAt;
  const ok =
    ordinary.ended &&
    ordinary.body === 'ok' &&
    ordinaryCompletedAt > 0 &&
    shutdownEmittedAt >= ordinaryCompletedAt && // waited for the ordinary in-flight request
    stream.ended && // the long-lived stream closed gracefully, client saw end (not reset)
    !forceCloseFired && // the force-close path never ran
    drainMs < FORCE_CLOSE_MS;
  report(
    {
      ordinaryDrained: ordinary.ended && ordinary.body === 'ok',
      streamClosedGracefully: stream.ended,
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
