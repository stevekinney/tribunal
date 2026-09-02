import { tribunalScopeVocabulary } from './scope-vocabulary';
import { tribunalMcpInstructions } from './instructions';
import { tribunalMcpServerName, tribunalMcpServerVersion } from './server-identity';
import { getRepositoryTool, listRepositoriesTool } from './tools/repository-tools';
import { getPullRequestTool, listPullRequestsTool } from './tools/pull-request-tools';
import { getReviewRunTool, listReviewRunsTool } from './tools/review-run-tools';
import { getReviewFindingTool, listReviewFindingsTool } from './tools/finding-tools';
import { getCostSummaryTool, listCostEventsTool } from './tools/cost-tools';

/**
 * Every operation Tribunal serves, keyed by its wire name.
 *
 * The map exists so the names are available as literal types. `defineTool`
 * returns a definition whose `name` is typed `string`, so a union derived from
 * the registry itself would collapse to `string` and the golden-prompt
 * specification could reference a tool that does not exist without `tsc`
 * noticing. Keying the map by literal preserves them, and
 * `registry.test.ts` asserts each key equals the definition's own `name` so
 * the two cannot drift.
 */
export const tribunalMcpOperations = {
  list_repositories: listRepositoriesTool,
  get_repository: getRepositoryTool,
  list_pull_requests: listPullRequestsTool,
  get_pull_request: getPullRequestTool,
  list_review_runs: listReviewRunsTool,
  get_review_run: getReviewRunTool,
  list_review_findings: listReviewFindingsTool,
  get_review_finding: getReviewFindingTool,
  list_cost_events: listCostEventsTool,
  get_cost_summary: getCostSummaryTool,
} as const;

/** The name of any tool this server serves, as a compile-time union. */
export type TribunalMcpOperationName = keyof typeof tribunalMcpOperations;

/**
 * Tribunal's injected MCP registry.
 *
 * Built through the vocabulary's own `defineRegistry` rather than as a bare
 * object literal: an inferred registry would default its scope parameter to
 * `string` and accept a primitive from a different vocabulary with no type
 * error, after which `getSupportedScopes()` would advertise a scope this
 * vocabulary has no description for and whose `isScope()` returns false — a
 * scope the authorization layer cannot issue for a primitive the server does
 * serve.
 *
 * `resources` and `prompts` are empty, and that is this issue's decision
 * rather than an omission. `documentation/mcp-scopes.md` left "resources
 * versus tools-only" open and assigned it here. Tools alone cover every
 * capability family in the vocabulary; resources would additionally commit
 * Tribunal to the `resources/subscribe` and `subscriptions/listen` surface,
 * whose authorization has to be enforced at the HTTP boundary by the consumer
 * rather than by the engine, and no client requirement asks for it. Adding one
 * later is additive.
 *
 * `conformanceOnlyTools` is likewise absent: the `conformance:read` scope is
 * reserved in the vocabulary, but what its fixture returns is TRI-30's
 * decision against Tribunal's real conformance needs, not a payload to guess
 * here.
 */
export const tribunalMcpRegistry = tribunalScopeVocabulary.defineRegistry({
  instructions: tribunalMcpInstructions,
  serverInfo: { name: tribunalMcpServerName, version: tribunalMcpServerVersion },
  tools: Object.values(tribunalMcpOperations),
  resources: [],
  prompts: [],
});
