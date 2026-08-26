/**
 * Server instructions passed to the MCP client on initialize. The first
 * ~500 characters must stand alone as a complete, meaningful description
 * (purpose, capability families, authentication) -- some clients only
 * surface that much. Never contains placeholder/"customize this" text,
 * checked by `content-boundaries.test.ts`.
 *
 * A plain exported string rather than a Markdown file imported with a
 * `with { type: 'text' }` import attribute: that attribute is a Bun
 * loader feature this package's test suite (Vitest, running under Vite)
 * does not honor, and a source string that must be readable identically
 * under both toolchains is simpler than reconciling two loaders for one
 * file.
 *
 * This package ships with zero default tools, resources, or prompts (see
 * the barrel files under `tools/`, `resources/`, and `prompts/`) -- it is
 * the reusable MCP engine (server factory, scope enforcement, response
 * bounding, metrics) that a consuming application registers its own
 * operations against, not a server with a fixed capability set of its
 * own. This text is written for that consuming application to adapt: it
 * describes the engine's guarantees, not any specific tool.
 */
const instructions = `This is a Model Context Protocol (MCP) server exposing tools, resources, and prompts registered by the embedding application. Every call must carry an OAuth bearer token scoped to the operation it invokes; there is no anonymous or service-account access, and every operation acts only on the authenticated caller's own account.

## Capability families

Tools, resources, and prompts are registered by the application embedding this server -- consult \`tools/list\`, \`resources/list\`, and \`prompts/list\` for the current set, since none are built in.

## Authentication and boundaries

Every request requires a bearer token. Each registered tool, resource, and prompt declares the single OAuth scope it requires; a token missing that scope is refused before the operation runs, with a challenge naming the scope actually needed. A tool result larger than 256KB of serialized content is replaced with a clear error rather than truncated, so a client never receives malformed structured content.

## Workflow

Call \`tools/list\`, \`resources/list\`, and \`prompts/list\` to discover what this deployment actually registers, then invoke the ones relevant to the current task by name.`;

export default instructions;
