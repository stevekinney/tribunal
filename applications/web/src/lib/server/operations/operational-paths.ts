/**
 * The operational endpoints that must dispatch ahead of session hydration, the
 * dev auth bypass, AND the MCP mount (TRI-52): the public `/health` liveness
 * gate, the authenticated `/health/ready`, and `/metrics`.
 *
 * Every identity- or mount-populating handle skips these paths, so a forged
 * cookie triggers no session lookup, a dev-auth-bypass does no database upsert,
 * and a pending or failed MCP mount cannot hang the endpoints during the very
 * incident they exist to diagnose. None of these routes reads `event.locals.user`
 * or the mount, so skipping those handles changes nothing but latency and blast
 * radius.
 */
export function isOperationalPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/health/ready' || pathname === '/metrics';
}
