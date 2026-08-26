import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpServer } from './server.js';
import { hasValidLocalhostRebindingHeaders } from './localhost-request-validation.js';
import { mcpScopes } from './scopes.js';
import { logger } from './logger.js';

import type { McpUserProfile } from './types/primitives.js';

const port = Number.parseInt(process.env.MCP_CONFORMANCE_PORT ?? '3137', 10);

function createConformanceUser(userId: string): McpUserProfile {
  return {
    id: userId,
    email: 'conformance@localhost',
    name: 'Conformance User',
    image: null,
    role: 'user',
  };
}

function convertIncomingHeaders(
  incomingHeaders: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();
  for (const [headerName, headerValue] of Object.entries(incomingHeaders)) {
    if (Array.isArray(headerValue)) {
      for (const value of headerValue) {
        headers.append(headerName, value);
      }
      continue;
    }
    if (headerValue !== undefined) {
      headers.set(headerName, headerValue);
    }
  }
  return headers;
}

/**
 * One factory serving both the modern (`2026-07-28`) and legacy
 * (`2025-11-25`) protocol eras through the SDK's stateless fallback. Each
 * conformance connection gets a fresh, unauthenticated user identity;
 * this server is for local/CI protocol conformance only, never exposed
 * publicly.
 */
const mcpHttpHandler: ReturnType<typeof createMcpHandler> = createMcpHandler(
  (requestContext) => {
    const userId = randomUUID();
    return createMcpServer({
      userId,
      user: createConformanceUser(userId),
      enableUiExtension: true,
      enableConformanceMode: true,
      era: requestContext.era,
      // This standalone server is local/CI-only and every connection
      // gets a throwaway random identity, so there is no real per-user
      // boundary to enforce here the way a production deployment would
      // (one event bus per authenticated user) — every conformance
      // connection shares this single process-wide handler and bus,
      // which is fine for exercising the wire protocol.
      publishResourceUpdate: async (uri) => mcpHttpHandler.notify.resourceUpdated(uri),
      // This standalone server exists to exercise every registered
      // operation, including any conformance-only fixtures — grant the
      // entire vocabulary rather than only what a real OAuth flow would
      // ever issue.
      scopes: mcpScopes,
    });
  },
  { legacy: 'stateless' },
);

const nodeHandler = toNodeHandler(mcpHttpHandler);

const server = createServer((incomingMessage, serverResponse) => {
  if ((incomingMessage.url ?? '').split('?')[0] !== '/mcp') {
    serverResponse.statusCode = 404;
    serverResponse.end('Not found');
    return;
  }

  const headers = convertIncomingHeaders(incomingMessage.headers);
  if (!hasValidLocalhostRebindingHeaders(headers)) {
    serverResponse.statusCode = 403;
    serverResponse.end('Forbidden');
    return;
  }

  void nodeHandler(incomingMessage, serverResponse);
});

server.listen(port, '127.0.0.1', () => {
  logger.info({ port }, 'MCP conformance server listening');
});
