import {
  createMcpHttpServingLayer,
  createMcpServingHandler,
  type McpHandlerSeams,
} from '@lostgradient/mcp/http';
import { McpConcurrencyLimiter, RequestRateLimiter } from '@lostgradient/mcp/rate-limit';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import type { McpAuthenticationSeams } from '@lostgradient/mcp/http';
import type { SvelteKitMcpRuntime } from '@lostgradient/mcp/sveltekit';
import { hashWithSha256 } from '$lib/server/encryption';
import { mcpLogger } from '$lib/server/mcp-logger';
import { tribunalMcpRegistry } from '$lib/server/mcp/registry';
import { resolveUserProfile } from '$lib/server/oauth/identity';
import {
  MCP_PROTOCOL_VERSION,
  isMcpConformanceMode,
  mcpAllowedOrigins,
  mcpConcurrencySlotStore,
  mcpRateLimitConfiguration,
  mcpResourceUrl,
  mcpRuntimeLimits,
  mcpSlidingWindowStore,
  mcpTrustedProxyConfiguration,
  mcpUiExtension,
} from '$lib/server/oauth/configuration';
import { tribunalOAuthScopeConfiguration } from '$lib/server/oauth/scopes';

/**
 * Assembles the `SvelteKitMcpRuntime` the mount consumes.
 *
 * The published library ships no turnkey runtime — the four-method shape is
 * composed here from `@lostgradient/mcp/http`: `createMcpServingHandler`
 * provides `start`/`shutdown`/`publishGrantRevocation` (and builds a per-user
 * MCP server from the injected registry), and `createMcpHttpServingLayer`
 * wraps it with network admission, authentication, and concurrency to provide
 * `handle`. The rate/concurrency limiters use the shared in-memory stores
 * (TRI-41 scope decision; TRI-49/56 swap in Redis).
 *
 * The OAuth token store is shared with the OAuth host seams so the
 * authenticator validates the same tokens the OAuth endpoints mint.
 */
export function createTribunalMcpRuntime(stores: OAuthStores): SvelteKitMcpRuntime {
  const handlerSeams: McpHandlerSeams = {
    reportDegradation: (degradation) => {
      mcpLogger.warn({ degradation }, 'mcp serving handler degradation');
    },
    recordEvent: (outcome) => {
      mcpLogger.info({ outcome }, 'mcp serving handler event');
    },
    onError: (error, operation, userId) => {
      mcpLogger.error({ err: error, operation, userId }, 'mcp serving handler error');
    },
  };

  const handler = createMcpServingHandler({
    registry: tribunalMcpRegistry,
    configuration: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      maximumRequestBodyBytes: mcpRuntimeLimits.maximumRequestBodyBytes,
      maximumSubscriptionsPerUser: mcpRuntimeLimits.maximumSubscriptionsPerUser,
      userHandlerSweepIntervalMilliseconds: mcpRuntimeLimits.userHandlerSweepIntervalMilliseconds,
      userHandlerIdleMilliseconds: mcpRuntimeLimits.userHandlerIdleMilliseconds,
      enableUiExtension: mcpUiExtension.enabled,
      enableConformanceMode: isMcpConformanceMode(),
    },
    seams: handlerSeams,
  });

  const rateLimiter = new RequestRateLimiter(
    mcpRateLimitConfiguration,
    () => mcpSlidingWindowStore,
  );
  const concurrencyLimiter = new McpConcurrencyLimiter(
    mcpConcurrencySlotStore,
    mcpRateLimitConfiguration.maximumConcurrent,
  );

  const authenticationSeams: McpAuthenticationSeams = {
    tokens: stores.tokens,
    resolveUserProfile,
    hashCredential: hashWithSha256,
    rateLimiter,
    recordEvent: (outcome, requestId) => {
      mcpLogger.info({ outcome, requestId }, 'mcp authentication event');
    },
  };

  const servingLayer = createMcpHttpServingLayer({
    authenticationConfiguration: {
      resource: mcpResourceUrl,
      protocolVersion: MCP_PROTOCOL_VERSION,
      supportedScopes: tribunalOAuthScopeConfiguration.supportedScopes,
      allowedOrigins: mcpAllowedOrigins,
      maximumBearerTokenLength: mcpRuntimeLimits.maximumBearerTokenLength,
      maximumFailedAuthenticationAttempts: mcpRuntimeLimits.maximumFailedAuthenticationAttempts,
      dnsRebindingProtection: mcpRuntimeLimits.dnsRebindingProtection,
      trustedProxy: mcpTrustedProxyConfiguration,
    },
    authenticationSeams,
    rateLimiter,
    concurrencyLimiter,
    handler,
  });

  return {
    start: () => handler.start(),
    shutdown: () => handler.shutdown(),
    publishGrantRevocation: (subjectId) => handler.publishGrantRevocation(subjectId),
    handle: (context) => servingLayer.handle(context),
  };
}
