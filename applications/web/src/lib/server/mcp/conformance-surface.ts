import { isMcpConformanceMode } from '$lib/server/oauth/configuration';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';

/**
 * Whether the conformance fixture surface is served.
 *
 * Conformance mode (`MCP_CONFORMANCE_MODE=true`) exposes a synthetic fixture
 * tool for protocol conformance runs. It is disabled whenever the dev auth
 * bypass is armed: an armed bypass may be externally reachable (Tribunal has no
 * tunnel-reachability signal, so an armed bypass is the proxy for it), and the
 * conformance surface must not be exposed alongside a login bypass — the same
 * pairing Protokit's tunnel mode disables together (TRI-45 AC3).
 *
 * A pure composition of the two flags kept in its own module so it is unit
 * testable without the MCP runtime's construction graph, and so neither
 * `configuration.ts` nor `runtime.ts` has to import the other's dependency.
 */
export function conformanceSurfaceEnabled(): boolean {
  return isMcpConformanceMode() && !isDevAuthBypassEnabled();
}
