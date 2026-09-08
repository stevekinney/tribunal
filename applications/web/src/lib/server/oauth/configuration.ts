import { DEFAULT_NEGOTIATED_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { env } from '$env/dynamic/private';
import {
  createInMemoryConcurrencySlotStore,
  createInMemorySlidingWindowStore,
} from '@lostgradient/mcp/rate-limit';
import type {
  ConcurrencySlotStore,
  AtomicSlidingWindowStore,
  OAuthConfiguration,
  OAuthDiscoveryConfiguration,
  OAuthRateLimitCategory,
  RateLimitConfiguration,
  TrustedProxyConfiguration,
} from '@lostgradient/mcp/oauth';
import { tribunalMcpServerName } from '$lib/server/mcp/server-identity';

/**
 * Static OAuth + MCP configuration for the mount, plus the primitives the MCP
 * runtime shares with it (protocol version, resource URL, rate-limit stores,
 * trusted-proxy config).
 *
 * The values here are read once at module scope, when the mount is constructed.
 * The surface ships disabled (`MCP_ENABLED` defaults to `false`), so production
 * URL/TTL/limit provisioning is TRI-60's; these are sensible dev-first defaults.
 * The rate-limit stores are in-memory per the TRI-41 scope decision — TRI-49/56
 * swap in Redis, and TRI-50 replaces the permissive trusted-proxy config with
 * Fly's edge CIDRs.
 */

/** The MCP protocol version advertised in discovery metadata and negotiation. */
export const MCP_PROTOCOL_VERSION = DEFAULT_NEGOTIATED_PROTOCOL_VERSION;

/** Whether the mount serves requests. Defaults to disabled (TRI-26 rollout flag). */
export const isMcpEnabled = (): boolean => env.MCP_ENABLED === 'true';

/** Whether the conformance-only surface is active (never in production). */
export const isMcpConformanceMode = (): boolean => env.MCP_CONFORMANCE_MODE === 'true';

function readBaseUrl(): URL {
  // Server origin the OAuth issuer, callbacks, and resource identifier derive
  // from. TRI-60 sets this in production; the default keeps local dev working.
  const raw = env.MCP_BASE_URL?.trim() || 'http://localhost:5173';
  return new URL(raw);
}

export const mcpBaseUrl = readBaseUrl();
export const mcpIssuer = mcpBaseUrl.origin;
export const mcpResourceUrl = new URL('/mcp', mcpBaseUrl);

/** The mcp-ui extension is off; discovery and the OAuth seams must agree. */
export const mcpUiExtension = { enabled: false } as const;

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const CLIENT_SECRET_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // effectively non-expiring

/**
 * Permissive trusted-proxy config: trust no forwarding header and count zero
 * hops, so `getClientAddress()` is taken at face value. TRI-50 replaces this
 * with Fly's edge CIDRs and the correct hop count.
 */
export const mcpTrustedProxyConfiguration: TrustedProxyConfiguration = {
  trustedProxyCidrs: [],
  trustedProxyHeader: undefined,
  trustedProxyHopCount: 0,
};

const rateLimitCategory = (
  maximumRequests: number,
  windowSeconds: number,
): { maximumRequests: number; windowSeconds: number } => ({ maximumRequests, windowSeconds });

export const mcpRateLimitConfiguration: RateLimitConfiguration = {
  categories: {
    oauth_authorize: rateLimitCategory(20, 60),
    oauth_register: rateLimitCategory(5, 60),
    oauth_token_network: rateLimitCategory(60, 60),
    oauth_token_client: rateLimitCategory(30, 60),
    oauth_revoke: rateLimitCategory(30, 60),
    mcp_network: rateLimitCategory(120, 60),
    mcp_user: rateLimitCategory(300, 60),
    failed_authentication: rateLimitCategory(10, 60),
  } satisfies Record<OAuthRateLimitCategory, { maximumRequests: number; windowSeconds: number }>,
  maximumConcurrent: 100,
  keyNamespace: 'tribunal-mcp',
};

/** Shared in-memory rate-limit stores (one per process). */
export const mcpSlidingWindowStore: AtomicSlidingWindowStore = createInMemorySlidingWindowStore();
export const mcpConcurrencySlotStore: ConcurrencySlotStore = createInMemoryConcurrencySlotStore();

/**
 * Limits the MCP serving handler and authenticator need, exported so the
 * runtime builds its configuration from the same source as the mount.
 */
export const mcpRuntimeLimits = {
  maximumRequestBodyBytes: 1_048_576, // 1 MiB
  maximumSubscriptionsPerUser: 100,
  userHandlerSweepIntervalMilliseconds: 60_000,
  userHandlerIdleMilliseconds: 300_000,
  maximumBearerTokenLength: 4_096,
  maximumFailedAuthenticationAttempts: 10,
  dnsRebindingProtection: true,
} as const;

/** Origins the MCP surface accepts (DNS-rebinding / CORS admission). */
export const mcpAllowedOrigins: ReadonlySet<string> = new Set([mcpBaseUrl.origin]);

function isTrustedOrigin(origin: string): boolean {
  return origin === mcpBaseUrl.origin;
}

/** The full OAuth host configuration seam. */
export const tribunalOAuthConfiguration: OAuthConfiguration = {
  issuer: mcpIssuer,
  baseUrl: mcpBaseUrl,
  resource: mcpResourceUrl,
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
  clientSecretTtlSeconds: CLIENT_SECRET_TTL_SECONDS,
  isTrustedOrigin,
  trustedProxy: mcpTrustedProxyConfiguration,
  rateLimits: mcpRateLimitConfiguration,
  mcpUiExtension,
  rateLimitStores: {
    slidingWindow: mcpSlidingWindowStore,
    concurrencySlots: mcpConcurrencySlotStore,
  },
};

/** The discovery-metadata configuration; must agree with the OAuth config. */
export const tribunalOAuthDiscoveryConfiguration: OAuthDiscoveryConfiguration = {
  issuer: mcpIssuer,
  baseUrl: mcpBaseUrl,
  resource: mcpResourceUrl,
  serverName: tribunalMcpServerName,
  mcpProtocolVersion: MCP_PROTOCOL_VERSION,
  mcpUiExtension,
};
