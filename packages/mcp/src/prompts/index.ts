import type { McpPromptDefinition } from '../types/primitives.js';

// The production prompt registry. This package ships with zero default
// prompts: it is the reusable MCP engine, not a fixed set of operations.
// A consuming application appends its own `definePrompt(...)` results
// here.
export const allPrompts: McpPromptDefinition[] = [];
