import { describe, expect, it, vi } from 'vitest';
import {
  runMcpConformance,
  type McpConformanceEra,
  type McpConformanceResult,
} from '@lostgradient/mcp';

vi.mock('$env/dynamic/private', () => ({ env: { MCP_SERVER_NAME: 'tribunal-mcp-server' } }));

/**
 * The readers are mocked, not the tools.
 *
 * Conformance is a statement about the protocol path — that every tool
 * Tribunal advertises can be listed, called through a real MCP client over
 * both protocol eras, and returns a result the SDK accepts against its declared
 * output schema. It is not a statement about the database or GitHub, both of
 * which have their own tests. So the handlers run for real and the readers
 * beneath them return fixed, schema-shaped data, which keeps a failure here
 * meaning "the protocol surface is wrong" and nothing else.
 */
const repository = {
  id: 9001,
  owner: 'lost-gradient',
  name: 'tribunal',
  defaultBranch: 'main',
  latestCommit: 'abc123',
  installationAccount: 'lost-gradient',
  installationId: 7001,
};

const pullRequest = {
  number: 412,
  title: 'Conformance fixture pull request',
  state: 'open' as const,
  isDraft: false,
  authorLogin: 'contributor',
  headRef: 'feature',
  headSha: 'abc123',
  baseRef: 'main',
  htmlUrl: 'https://github.com/lost-gradient/tribunal/pull/412',
  updatedAt: '2026-08-01T00:00:00.000Z',
  mergedAt: null,
};

const reviewRun = {
  id: 'run-1',
  status: 'posted',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  pullRequestNumber: 412,
  costEstimateUsd: 1.25,
  startedAt: '2026-08-01T00:00:00.000Z',
  finishedAt: '2026-08-01T00:05:00.000Z',
};

const finding = {
  id: 'finding-1',
  runId: 'run-1',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  pullRequestNumber: 412,
  path: 'src/example.ts',
  startLine: 10,
  endLine: 12,
  side: 'RIGHT',
  severity: 'warning',
  title: 'Conformance fixture finding',
  body: 'Synthetic finding text.',
  suggestion: null,
  verificationStatus: 'verified',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const costEvent = {
  occurredAt: '2026-08-01T00:00:00.000Z',
  amountUsd: 2.5,
  source: 'estimate' as const,
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  agentSlug: 'security',
};

vi.mock('./readers/repository-reader', () => ({
  listAccessibleRepositories: vi.fn(async () => ({ ok: true, repositories: [repository] })),
  findAccessibleRepository: vi.fn(async () => ({ ok: true, repository })),
  findAccessibleRepositoriesByName: vi.fn(async () => ({ ok: true, matches: [repository] })),
}));

vi.mock('./readers/pull-request-reader', () => ({
  listRepositoryPullRequests: vi.fn(async () => ({
    ok: true,
    repositoryId: 9001,
    pullRequests: [pullRequest],
    page: 1,
    perPage: 25,
    hasNextPage: false,
  })),
  getRepositoryPullRequest: vi.fn(async () => ({
    ok: true,
    repositoryId: 9001,
    pullRequest: {
      ...pullRequest,
      description: 'Synthetic description.',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      isMerged: false,
      commentCount: 1,
      reviewCommentCount: 0,
      commitCount: 2,
      operationalState: null,
    },
  })),
}));

vi.mock('./readers/review-run-reader', () => ({
  listReviewRuns: vi.fn(async () => ({ items: [reviewRun], limit: 25, offset: 0, hasMore: false })),
  getReviewRun: vi.fn(async () => reviewRun),
}));

vi.mock('./readers/finding-reader', () => ({
  listReviewFindings: vi.fn(async () => ({
    items: [finding],
    limit: 25,
    offset: 0,
    hasMore: false,
  })),
  getReviewFinding: vi.fn(async () => finding),
}));

vi.mock('./readers/cost-event-reader', () => ({
  listCostEvents: vi.fn(async () => ({ items: [costEvent], limit: 25, offset: 0, hasMore: false })),
  summarizeCostEvents: vi.fn(async () => ({
    source: 'estimate',
    windowDays: 30,
    since: '2026-07-02T00:00:00.000Z',
    eventCount: 1,
    totalUsd: 2.5,
    byRepository: [{ repositoryId: 9001, label: 'lost-gradient/tribunal', amountUsd: 2.5 }],
    byAgent: [{ label: 'security', amountUsd: 2.5 }],
  })),
}));

import { tribunalMcpOperations, tribunalMcpRegistry } from './registry';
import { tribunalScopeVocabulary } from './scope-vocabulary';

/**
 * The harness only invokes tools it is given arguments for — it iterates
 * `toolProbes`, not the registry. A probe set that named a subset would produce
 * a green run that says nothing about the tools it left out, so every tool
 * Tribunal serves is listed here, and a test below fails if the registry ever
 * grows a tool this map does not name.
 *
 * Each pull request probe supplies exactly one repository selector: the tools
 * refuse a call carrying both `repositoryId` and `owner`/`name`, so a probe
 * that sent both would fail for a reason that has nothing to do with the
 * protocol.
 */
const toolProbes = {
  list_repositories: {},
  get_repository: { repositoryId: 9001 },
  list_pull_requests: { repositoryId: 9001 },
  get_pull_request: { repositoryId: 9001, pullRequestNumber: 412 },
  list_review_runs: {},
  get_review_run: { runId: 'run-1' },
  list_review_findings: {},
  get_review_finding: { findingId: 'finding-1' },
  list_cost_events: {},
  get_cost_summary: {},
} satisfies Record<keyof typeof tribunalMcpOperations, Record<string, unknown>>;

/**
 * The harness's default identity is not a Tribunal user, and every handler
 * refuses a subject that does not parse as one — so a run without this would
 * fail every probe for a reason that is correct and beside the point.
 */
const identity = {
  userId: '7',
  user: {
    id: '7',
    email: 'conformance@example.com',
    name: 'Conformance',
    image: null,
    role: 'user',
  },
};

function describeFailures(results: readonly McpConformanceResult[]): string[] {
  return results
    .filter((result) => result.status !== 'passed')
    .map((result) => `${result.era} ${result.name}: ${result.error ?? 'failed'}`);
}

const eras: McpConformanceEra[] = ['modern', 'legacy'];

describe.each(eras)('MCP protocol conformance, %s era', (era) => {
  it("passes every behaviour against Tribunal's registry", async () => {
    expect.assertions(2);

    const results = await runMcpConformance({
      registry: tribunalMcpRegistry,
      scopeVocabulary: tribunalScopeVocabulary,
      era,
      identity,
      toolProbes,
    });

    // Listed by name so a failure is nameable in the output rather than a
    // count. A failed behaviour never prevents later ones from running, so
    // this collects every failure at once.
    expect(describeFailures(results)).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });

  it('invokes every tool Tribunal serves, not a subset', async () => {
    expect.assertions(1);

    const results = await runMcpConformance({
      registry: tribunalMcpRegistry,
      scopeVocabulary: tribunalScopeVocabulary,
      era,
      identity,
      toolProbes,
    });
    const invoked = results
      .filter((result) => result.name.startsWith('tools/call:'))
      .map((result) => result.name.slice('tools/call:'.length))
      .sort();

    expect(invoked).toEqual(tribunalMcpRegistry.tools.map((tool) => tool.name).sort());
  });
});

describe('the probe set', () => {
  it('names exactly the tools in the registry', () => {
    expect.assertions(1);

    // A tool added to the registry without a probe would otherwise silently
    // fall outside the conformance run. `satisfies` catches a missing key at
    // compile time; this catches one at runtime for a registry built any
    // other way.
    expect(Object.keys(toolProbes).sort()).toEqual(
      tribunalMcpRegistry.tools.map((tool) => tool.name).sort(),
    );
  });
});
