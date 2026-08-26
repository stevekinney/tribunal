import { allPrompts } from './prompts/index.js';
import { allResources } from './resources/index.js';
import { allTools } from './tools/index.js';

/**
 * AUTHZ-001: the scopes an OAuth client can actually request and see
 * advertised, derived mechanically from the *production* registries
 * (`allTools`/`allResources`/`allPrompts` — never `conformanceOnlyTools`,
 * which is only ever registered when `enableConformanceMode` is on and is
 * never reachable through a real deployment's OAuth flow). Computing this
 * from the registries themselves, rather than hand-maintaining a parallel
 * list, is what makes "authorization server and protected-resource metadata
 * publish the same supported scopes" mechanically true everywhere this is
 * called from, and what keeps a conformance-only fixture's scope
 * (`audit:read`) out of production metadata without a second place that has
 * to remember to exclude it.
 *
 * Sorted for a stable, deterministic `scope` string wherever this is joined
 * with a space (metadata `scopes_supported`, the `/mcp` 401 challenge's
 * `scope` attribute).
 */
export function getSupportedScopes(): string[] {
  const scopes = new Set<string>();
  for (const tool of allTools) scopes.add(tool.requiredScope);
  for (const resource of allResources) scopes.add(resource.requiredScope);
  for (const prompt of allPrompts) scopes.add(prompt.requiredScope);
  return [...scopes].sort();
}
