import type { McpToolDefinition } from '../types/primitives.js';

// The production tool registry — every entry here is advertised and
// callable against a real deployment. It must never contain a
// synthetic/protocol-conformance-only fixture. This package ships with
// zero default tools: it is the reusable MCP engine, not a fixed set of
// operations. A consuming application appends its own `defineTool(...)`
// results here.
export const allTools: McpToolDefinition[] = [];

// Tools defined with `defineTool()` (so they carry the same required
// metadata as production tools) but only ever registered when
// `enableConformanceMode` is true — see `server.ts`. A tool that returns
// synthetic/generated data purely to exercise a protocol behavior (cursor
// pagination, for example) belongs here instead of in `allTools`, so it
// is never reachable outside conformance mode.
export const conformanceOnlyTools: McpToolDefinition[] = [];
