import { describe, expect, it } from 'vitest';
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
