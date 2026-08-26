/**
 * The server's OAuth scope vocabulary, in one place. Every tool, resource,
 * and prompt declares a `requiredScope` from this set
 * (`McpToolDefinition`/`McpResourceDefinition`/`McpPromptDefinition` in
 * `types/primitives.ts`), which is what turns "a scope exists" into
 * "every operation is gated by one." A generic all-access scope is
 * deliberately not an option: `requiredScope` is required on every
 * registered operation, and there is no "no scope check" escape hatch in
 * the type system.
 *
 * This package ships with zero default tools, resources, or prompts (see
 * the `CLAUDE.md` note in each barrel file) -- the three values below are
 * a starter vocabulary for whatever operations a consuming application
 * registers, not a claim that any of them are currently in use. Extend
 * this list, and `mcpScopeDescriptions` alongside it, when a real
 * operation needs a scope this set does not already cover; keep the
 * vocabulary small and drawn from what the registries actually do rather
 * than speculative.
 */
export const mcpScopes = ['profile:read', 'audit:read', 'prompts:read'] as const;

export type McpScope = (typeof mcpScopes)[number];

export function isMcpScope(value: string): value is McpScope {
  return (mcpScopes as readonly string[]).includes(value);
}

/**
 * Human-readable, consent-screen-facing description of what granting a
 * scope actually allows. Shown verbatim on an authorize page so the exact
 * requested scopes are something a user can read, not just a raw token
 * string.
 */
export const mcpScopeDescriptions: Record<McpScope, string> = {
  'profile:read': 'Read your profile information.',
  'audit:read': 'Read audit event history.',
  'prompts:read': "Use this server's prompt templates on your behalf.",
};
