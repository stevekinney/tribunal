import { describe, expect, it, vi } from 'vitest';

// Read the runtime env from a controlled empty object so the flag-default
// assertions below cannot depend on the ambient environment. The web unit
// suite runs directly (not through Turborepo), so `$env/dynamic/private`
// otherwise exposes the process env, and a shell or CI with MCP_ENABLED=true
// would flip `isMcpEnabled()` and fail this test.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  isMcpConformanceMode,
  isMcpEnabled,
  mcpBaseUrl,
  mcpRateLimitConfiguration,
  mcpResourceUrl,
  tribunalOAuthConfiguration,
  tribunalOAuthDiscoveryConfiguration,
} from './configuration';

describe('OAuth configuration', () => {
  it('derives the issuer, base, and resource URLs from the base URL', () => {
    expect(tribunalOAuthConfiguration.issuer).toBe(mcpBaseUrl.origin);
    expect(mcpResourceUrl.pathname).toBe('/mcp');
    expect(tribunalOAuthConfiguration.resource.href).toBe(mcpResourceUrl.href);
  });

  it('defaults the rollout and conformance flags to disabled', () => {
    expect(isMcpEnabled()).toBe(false);
    expect(isMcpConformanceMode()).toBe(false);
  });

  it('trusts only its own origin', () => {
    expect(tribunalOAuthConfiguration.isTrustedOrigin(mcpBaseUrl.origin)).toBe(true);
    expect(tribunalOAuthConfiguration.isTrustedOrigin('https://evil.example')).toBe(false);
  });

  it('agrees between the OAuth config and the discovery config', () => {
    expect(tribunalOAuthDiscoveryConfiguration.issuer).toBe(tribunalOAuthConfiguration.issuer);
    expect(tribunalOAuthDiscoveryConfiguration.mcpUiExtension.enabled).toBe(
      tribunalOAuthConfiguration.mcpUiExtension.enabled,
    );
  });

  it('configures a rate-limit category for every OAuth and MCP category', () => {
    expect(mcpRateLimitConfiguration.categories.oauth_authorize.maximumRequests).toBeGreaterThan(0);
    expect(mcpRateLimitConfiguration.categories.mcp_user.windowSeconds).toBeGreaterThan(0);
    expect(mcpRateLimitConfiguration.maximumConcurrent).toBeGreaterThan(0);
  });
});
