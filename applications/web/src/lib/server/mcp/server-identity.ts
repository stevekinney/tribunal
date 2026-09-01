import { env } from '$env/dynamic/private';

/**
 * The implementation identity Tribunal reports in the MCP `initialize`
 * response.
 *
 * A registry that omits `serverInfo` inherits the engine package's own name
 * and version, so clients and operators misattribute the server in
 * diagnostics, and any client behaviour keyed to `serverInfo` — compatibility
 * shims, version gates — reads the wrong implementation entirely.
 *
 * The name comes from `MCP_SERVER_NAME`, the variable the engine's environment
 * schema already requires and whose template default was deliberately removed
 * upstream so no deployment can ship an unnamed server. The fallback here is
 * not a substitute for setting it: enforcing the variable's presence is the
 * environment-validation issue's job, and this module must not throw at import
 * time, because the registry is imported by tests and by tooling that never
 * boots a server.
 */
export const tribunalMcpServerName = env.MCP_SERVER_NAME?.trim() || 'tribunal';

/**
 * Pinned to `applications/web`'s own package version by
 * `server-identity.test.ts`, which reads `package.json` and fails when the two
 * drift. A literal rather than a JSON import so the value survives every build
 * target the web application is compiled for.
 */
export const tribunalMcpServerVersion = '0.0.1';
