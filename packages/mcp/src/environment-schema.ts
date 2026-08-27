import { z } from 'zod';

/**
 * `z.coerce.boolean()` calls JavaScript's `Boolean(value)`, and every
 * non-empty string -- including the literal string `"false"` -- is
 * truthy. `MCP_CONFORMANCE_MODE` must not silently coerce `"false"` to
 * `true`, so this enumerates the two accepted string values explicitly
 * and transforms afterward instead of coercing.
 */
function strictBooleanEnvironmentFlag(defaultValue: boolean) {
  return z
    .enum(['true', 'false'])
    .optional()
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
}

/**
 * The raw Zod shape backing `packages/mcp`'s environment schema, factored
 * out of `env.ts` so it can be introspected without importing `env.ts`
 * itself. This file has no side effects: it never reads `process.env` and
 * never throws.
 *
 * `MCP_SERVER_NAME` has no default here -- `server.ts` falls back to a
 * name derived from this package's own `package.json` when it is unset,
 * rather than a hardcoded literal.
 */
export const mcpServerEnvironmentSchema = {
  MCP_SERVER_NAME: z.string().min(1).optional(),
  MCP_CONFORMANCE_MODE: strictBooleanEnvironmentFlag(false),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .optional()
    .default('info'),
  // Optional, defaulting to 'development' (ordinary Node convention) rather
  // than requiring the caller to set it -- this is a library package
  // imported by tests and by whatever application eventually wires it up,
  // not a standalone process with its own startup gate, so failing to
  // start over a missing NODE_ENV would poison every consumer's import,
  // including this package's own test suite.
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
};
