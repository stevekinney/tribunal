import { getSupportedScopes } from '@lostgradient/mcp';
import type { OAuthScopeConfiguration } from '@lostgradient/mcp/oauth';
import { tribunalMcpRegistry } from '$lib/server/mcp/registry';
import { tribunalScopeVocabulary, type TribunalMcpScope } from '$lib/server/mcp/scope-vocabulary';

/**
 * The OAuth scope configuration seam: the production scope vocabulary plus the
 * scopes an OAuth client may request. `supportedScopes` is derived mechanically
 * from the registry (`getSupportedScopes` walks the production registries and
 * excludes conformance-only tools), so the authorize endpoint and the
 * discovery metadata advertise exactly the scopes the mount actually serves —
 * never a hand-maintained parallel list.
 */
export const tribunalOAuthScopeConfiguration: OAuthScopeConfiguration<TribunalMcpScope> = {
  vocabulary: tribunalScopeVocabulary,
  supportedScopes: getSupportedScopes(tribunalMcpRegistry) as readonly TribunalMcpScope[],
};
