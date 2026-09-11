import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { getRequest, setResponse } from '@sveltejs/kit/node';

/**
 * A real `node:http` server that reproduces the one thing the mount fixture's
 * direct `handle()` cannot: the `@sveltejs/adapter-node` request path. The
 * deployed adapter converts the incoming Node request to a Web `Request` through
 * `@sveltejs/kit/node`'s `getRequest`, passing `bodySizeLimit` so its `get_raw_body`
 * enforces `BODY_SIZE_LIMIT` on the Node stream — a layer that lives above
 * SvelteKit's `handle` and is therefore invisible to a fixture that calls the
 * mount directly (TRI-48 criteria 3 and 6). This harness wires that exact seam:
 * `getRequest` → `dispatch` → `setResponse`, so a suite can drive the genuine
 * Node↔Web conversion and the backstop over a loopback socket.
 *
 * `base` is the configured MCP origin (`mcpBaseUrl.origin`), not the ephemeral
 * socket origin. `getRequest` builds the request URL as `base + req.url`, exactly
 * as the deployed adapter does from its `ORIGIN`, so the origin allowlist and the
 * token-audience check see the production resource regardless of the loopback
 * port the test bound to.
 */
export type AdapterNodeHarness = {
  /** The loopback origin to POST to, e.g. `http://127.0.0.1:53312`. */
  origin: string;
  close(): Promise<void>;
};

export type AdapterNodeHarnessInput = {
  /** Configured MCP origin the deployed adapter would build request URLs against. */
  base: string;
  /** The `BODY_SIZE_LIMIT` the adapter enforces, in bytes (already parsed). */
  bodySizeLimit: number;
  /** Handles the converted Web `Request` and returns the Web `Response` to write back. */
  dispatch: (request: Request) => Promise<Response>;
};

export async function startAdapterNodeHarness(
  input: AdapterNodeHarnessInput,
): Promise<AdapterNodeHarness> {
  const server = createServer((nodeRequest: IncomingMessage, nodeResponse: ServerResponse) => {
    void handleNodeRequest(nodeRequest, nodeResponse, input);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function handleNodeRequest(
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
  input: AdapterNodeHarnessInput,
): Promise<void> {
  try {
    const request = await getRequest({
      request: nodeRequest,
      base: input.base,
      bodySizeLimit: input.bodySizeLimit,
    });
    const response = await input.dispatch(request);
    await setResponse(nodeResponse, response);
  } catch (error) {
    respondWithError(nodeResponse, error);
  }
}

/**
 * Mirrors `@sveltejs/kit`'s Node handler: a body read that trips `BODY_SIZE_LIMIT`
 * rejects with a `SvelteKitError` carrying a numeric `status` (413) and a
 * `{ message }` body. The fixture's `handle` bypasses SvelteKit's `Server.respond`,
 * so this harness owns that error→response translation the way the framework
 * normally would. Anything without a numeric status is an unexpected 500.
 */
function respondWithError(nodeResponse: ServerResponse, error: unknown): void {
  const status =
    typeof (error as { status?: unknown } | null)?.status === 'number'
      ? (error as { status: number }).status
      : 500;
  const message =
    (error as { body?: { message?: unknown } } | null)?.body?.message ??
    (error instanceof Error ? error.message : 'Internal Error');
  if (!nodeResponse.headersSent) {
    nodeResponse.writeHead(status, { 'content-type': 'text/plain' });
  }
  nodeResponse.end(String(message));
}

export type AdapterConversionInput = {
  /** The configured MCP origin `getRequest` builds the request URL against. */
  base: string;
  /** Request path (and query), e.g. `/mcp`. */
  path: string;
  method?: string;
  /** Lowercase header names, as Node delivers them. */
  headers: Record<string, string>;
  /** Body chunks to stream through the Node request; omit for no body. */
  body?: Uint8Array[];
  /** The `BODY_SIZE_LIMIT` the adapter enforces, in bytes. */
  bodySizeLimit: number;
};

/**
 * Runs the exact `@sveltejs/adapter-node` conversion — `getRequest` with a
 * `bodySizeLimit` over `get_raw_body` — against a synthetic Node `IncomingMessage`
 * built from a `Readable`, and returns the converted Web `Request`. This exercises
 * the genuine backstop code (TRI-48 criteria 3, 4, 6) deterministically: unlike a
 * real socket, a body the adapter rejects mid-stream cannot surface as a client-side
 * `ECONNRESET`, and the caller controls the raw bytes independently of the declared
 * `content-length` (so a body that lies about its length can actually be sent). The
 * returned request's body stream errors with the adapter's `SvelteKitError` when the
 * bound trips, on read.
 */
export function convertRequestThroughAdapter(input: AdapterConversionInput): Promise<Request> {
  const chunks = input.body ?? [];
  const readable = Readable.from(
    (function* emit(): Generator<Buffer> {
      for (const chunk of chunks) yield Buffer.from(chunk);
    })(),
  );
  const nodeRequest = readable as unknown as IncomingMessage;
  nodeRequest.method = input.method ?? 'POST';
  nodeRequest.url = input.path;
  nodeRequest.headers = input.headers;
  nodeRequest.httpVersionMajor = 1;
  nodeRequest.httpVersionMinor = 1;
  return getRequest({
    request: nodeRequest,
    base: input.base,
    bodySizeLimit: input.bodySizeLimit,
  });
}
