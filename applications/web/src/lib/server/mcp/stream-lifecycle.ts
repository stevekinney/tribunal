/**
 * Identifies the long-lived MCP `subscriptions/listen` streams so a
 * graceful-shutdown drain can exclude them (TRI-43). Those streams must close
 * only through the transport shutdown path (`handler.shutdown()` →
 * `cache.closeAll()`), never by force-closing the connection mid-stream, or a
 * client loses in-flight resource notifications on every deploy.
 *
 * The library invokes `markServerOnlyCloseableStream` (an `McpHandlerSeams`
 * member) on exactly the listen responses and on nothing else, so wiring this in
 * is how Tribunal tags those responses. The drain that *consults* the tag is
 * TRI-51's; this module owns identifying the streams and exposes
 * `isServerOnlyCloseableStream` for that drain to call.
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
