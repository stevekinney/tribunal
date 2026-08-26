import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { allResources } from './resources/index.js';

/**
 * Advertising the MCP Apps UI extension is not just gated on
 * `createMcpServer`'s `enableUiExtension` flag (which a consuming
 * application controls, and could turn on by mistake) -- it also
 * requires at least one registered resource that is actually an MCP App
 * (`RESOURCE_MIME_TYPE`). This package ships zero default resources, so
 * this predicate is always `false` until a consuming application
 * registers one, mechanically keeping the capability advertised as
 * absent even if the flag is turned on with nothing to back it.
 *
 * This is the single source of truth for that predicate. `server.ts`'s
 * real `/mcp` capabilities call this function; a consuming application
 * that also advertises UI extension support in its own OAuth metadata
 * should call it too, rather than re-deriving its own copy, so a client
 * can never discover UI extension support in one place and not the
 * other.
 */
export function hasRegisteredUiExtensionResource(): boolean {
  return allResources.some((resource) => resource.mimeType === RESOURCE_MIME_TYPE);
}
