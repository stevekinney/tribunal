import { z } from 'zod';
import { createToolStructuredResponse } from '@lostgradient/mcp';
import { tribunalScopeVocabulary } from './scope-vocabulary';

/**
 * The synthetic tool behind `conformance:read`.
 *
 * `documentation/mcp-scopes.md` reserved the scope and its exclusion mechanism
 * and left what the fixture returns to this issue, deliberately: the answer
 * depends on what Tribunal's conformance runs actually need, which could not
 * be known when the vocabulary was settled.
 *
 * What they need is a tool that proves the protocol path end to end while
 * touching nothing real. So this returns a fixed structured payload with no
 * reader, no database, no GitHub call, and no field derived from the caller —
 * which makes it safe to invoke from any harness, in any environment, at any
 * time, and makes a failure unambiguously a protocol failure rather than a
 * data one.
 *
 * It deliberately exercises the same response shape the production tools use
 * (`createToolStructuredResponse` with a declared `outputSchema`), because a
 * fixture that took an easier path would prove the easier path works.
 *
 * Registered under `conformanceOnlyTools`, which keeps it out of
 * `getSupportedScopes()` structurally: that function walks the production
 * registries alone, so `conformance:read` is never advertised and — given the
 * authorize endpoint's rule that a scope outside the supported set is
 * `invalid_scope` — never obtainable through a real OAuth flow. Note that
 * `runMcpConformance` builds its handler with `enableConformanceMode: false`,
 * so this tool is not served during a conformance run either; it exists for a
 * harness that opts into conformance mode explicitly.
 */
export const conformanceFixtureTool = tribunalScopeVocabulary.defineTool({
  name: 'conformance_echo',
  title: 'Conformance fixture',
  description:
    'Returns a fixed synthetic payload. Exercises the MCP protocol path without reading any repository, pull request, review, finding, or cost data. Present only when conformance mode is enabled, and never grantable through an OAuth flow.',
  inputSchema: z.object({
    label: z
      .string()
      .min(1)
      .max(64)
      .default('conformance')
      .describe('Echoed back verbatim, so a harness can correlate call and response.'),
  }),
  outputSchema: z.object({
    label: z.string(),
    synthetic: z.literal(true),
    surface: z.literal('tools/call'),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    // Reads nothing at all, let alone anything outside Tribunal.
    openWorldHint: false,
  },
  requiredScope: 'conformance:read',
  async handler(input) {
    return createToolStructuredResponse(
      { label: input.label, synthetic: true as const, surface: 'tools/call' as const },
      `Conformance fixture responded to ${input.label}. This payload is synthetic and describes no real data.`,
    );
  },
});
