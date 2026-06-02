# Correlation and Request IDs

## Summary

Tribunal does not use a canonical "observability envelope" response body. An earlier,
larger system wrapped sandbox, chat, and workflow API routes in an `ObservabilityEnvelope`
that embedded logical outcomes at HTTP 200. **Those routes and that envelope no longer
exist.** Tribunal is a SvelteKit app whose only integration is GitHub, with no sandboxes,
chat, AI, workflow engine, or background workers, so there is nothing to wrap that way.

What survives is lightweight request correlation: every request gets a correlation ID and
a request ID injected into `event.locals` and echoed back on the response headers, so logs
can be traced across a single request.

## How correlation works today

The `correlationHandle` in `applications/web/src/hooks.server.ts` runs first in the handle
sequence. For each request it:

- Reads the `X-Correlation-Id` request header, or generates a `corr-<uuid>` value when the
  header is absent.
- Generates a per-request `req-<uuid>` request ID.
- Stores both on `event.locals` (`correlationId`, `requestId`) so downstream load
  functions and endpoints can include them in log lines.
- Sets `X-Correlation-ID` and `X-Request-ID` on the response so clients can correlate.

## Implementation references

- Correlation injection: `applications/web/src/hooks.server.ts` (`correlationHandle`)
- Structured logger: `applications/web/src/lib/server/logger.ts`

## Note on HTTP status codes

Routes return ordinary HTTP status codes. Validation and request failures use the standard
SvelteKit `error()` helper and conventional status codes (for example `400`, `401`, `404`,
`500`) — they are not embedded in a 200 envelope. The GitHub webhook endpoint
(`applications/web/src/routes/api/webhooks/github/+server.ts`) is the one place where a
`500` is intentionally returned on transient processing failure so GitHub will retry the
delivery.
