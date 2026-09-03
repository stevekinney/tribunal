import { fetchClientIdMetadataDocument, type OAuthHostSeams } from '@lostgradient/mcp/oauth';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import { hashWithSha256 } from '$lib/server/encryption';
import { mcpLogger } from '$lib/server/mcp-logger';
import type { TribunalMcpScope } from '$lib/server/mcp/scope-vocabulary';
import { tribunalOAuthConfiguration } from './configuration';
import { renderConsent } from './consent';
import { resolveIdentityBinding, resolveUserProfile } from './identity';
import { tribunalOAuthScopeConfiguration } from './scopes';
import { handleUnauthenticatedAuthorization } from './unauthenticated';

/**
 * Assembles the full `OAuthHostSeams` from Tribunal's implementations.
 *
 * `stores` is passed in rather than constructed here so the OAuth endpoints and
 * the MCP authenticator share one storage instance (and one connection pool).
 * `fetchClientIdMetadataDocument` uses the library's default SSRF-hardened
 * fetch (TRI-42 verifies it under Tribunal's runtime); `hashCredential` reuses
 * Tribunal's existing SHA-256 helper.
 */
export function createTribunalOAuthSeams(stores: OAuthStores): OAuthHostSeams<TribunalMcpScope> {
  return {
    fetchClientIdMetadataDocument,
    resolveIdentityBinding,
    resolveUserProfile,
    handleUnauthenticatedAuthorization,
    renderConsent,
    stores,
    scopes: tribunalOAuthScopeConfiguration,
    configuration: tribunalOAuthConfiguration,
    hashCredential: hashWithSha256,
    recordEvent: (event) => {
      mcpLogger.info(event, 'oauth event');
    },
  };
}
