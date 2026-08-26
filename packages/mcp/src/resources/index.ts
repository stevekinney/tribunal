import type { McpResourceDefinition } from '../types/primitives.js';

// The production resource registry. This package ships with zero default
// resources: it is the reusable MCP engine, not a fixed set of
// operations. A consuming application appends its own resource
// definitions here.
export const allResources: McpResourceDefinition[] = [];
