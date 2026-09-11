/**
 * Identifies the long-lived MCP `subscriptions/listen` streams so a
 * graceful-shutdown drain can exclude them (TRI-43). Those streams must close
 * only through the transport shutdown path (`handler.shutdown()` →
 * `cache.closeAll()`), never by force-closing the connection mid-stream, or a
 * client loses in-flight resource notifications on every deploy.
 *
 * The library invokes `markServerOnlyCloseableStream` (an `McpHandlerSeams`
 * member) on exactly the listen responses and on nothing else, so wiring this in
 * is how Tribunal tags those responses.
 *
 * How TRI-51's shutdown honors this: the library exposes no per-stream close —
 * only whole-transport teardown (`mount.dispose` → `runtime.shutdown` →
 * `cache.closeAll`). So rather than a drain that force-closes ordinary streams
 * while sparing tagged ones, `hooks.server.ts` closes the entire transport on the
 * shutdown signal, *before* adapter-node drains the HTTP server. That routes
 * every listen stream through `cache.closeAll` — the sanctioned path above — so
 * none is ever force-closed, and adapter-node's own force-close
 * (`SHUTDOWN_TIMEOUT` → `closeAllConnections`) is reached only if a stream somehow
 * fails to close in time. `isServerOnlyCloseableStream` therefore remains
 * available for a future finer-grained drain (and for the transport test below),
 * but Tribunal owns no force-close that needs to consult it today.
 *
 * A `WeakSet` keeps the tag off the wire (no client-visible header advertising
 * an internal shutdown detail) and lets each `Response` be garbage-collected
 * normally once it has been handled.
 */
const serverOnlyCloseableStreams = new WeakSet<Response>();

/** Tags a listen-stream response as one that only the transport may close. */
export function markServerOnlyCloseableStream(response: Response): Response {
  serverOnlyCloseableStreams.add(response);
  return response;
}

/** True when `response` is a listen stream a drain must not force-close. */
export function isServerOnlyCloseableStream(response: Response): boolean {
  return serverOnlyCloseableStreams.has(response);
}
