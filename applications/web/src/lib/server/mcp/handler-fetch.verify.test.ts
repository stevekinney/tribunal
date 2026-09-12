import { describe, expect, it, vi } from 'vitest';
import type { McpContext } from '@lostgradient/mcp';
import { tribunalMcpOperations, tribunalMcpRegistry } from './registry';

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
  title: 'Outbound fetch fixture pull request',
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
  title: 'Outbound fetch fixture finding',
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

type ProductionToolName = keyof typeof tribunalMcpOperations;
type RegisteredToolName = ProductionToolName | 'conformance_echo';

const toolSamples = {
  list_repositories: { limit: 25, offset: 0 },
  get_repository: { repositoryId: 9001 },
  list_pull_requests: { repositoryId: 9001, state: 'open', page: 1, perPage: 25 },
  get_pull_request: { repositoryId: 9001, pullRequestNumber: 412 },
  list_review_runs: { limit: 25, offset: 0 },
  get_review_run: { runId: 'run-1' },
  list_review_findings: { limit: 25, offset: 0 },
  get_review_finding: { findingId: 'finding-1' },
  list_cost_events: { limit: 25, offset: 0 },
  get_cost_summary: { source: 'estimate', windowDays: 30 },
  conformance_echo: { label: 'outbound-fetch' },
} satisfies Record<RegisteredToolName, Record<string, unknown>>;

function context(): McpContext {
  return {
    userId: '7',
    user: {
      id: '7',
      email: 'outbound-fetch@example.com',
      name: 'Outbound Fetch',
      image: null,
      role: 'user',
    },
    signal: new AbortController().signal,
  };
}

function sortedRegisteredTools() {
  return [...tribunalMcpRegistry.tools, ...(tribunalMcpRegistry.conformanceOnlyTools ?? [])].sort(
    (left, right) => {
      if (left.name === right.name) return 0;
      return left.name < right.name ? -1 : 1;
    },
  );
}

describe('MCP registered handlers', () => {
  it('runs every registered handler without direct outbound fetch', async () => {
    // Readers legitimately use the database and cached GitHub client. Mock
    // those boundaries, leaving every registered handler and its helpers real.
    // Unlike a source-text scan, this also catches aliased or indirect fetches.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    try {
      const tools = sortedRegisteredTools();
      const registeredToolNames = tools.map((tool) => tool.name);
      const sampleNames = Object.keys(toolSamples).sort();

      const missingSamples = registeredToolNames.filter((name) => !(name in toolSamples));
      expect(missingSamples, 'Add sample input before registering a new MCP tool.').toEqual([]);

      const staleSamples = sampleNames.filter((name) => !registeredToolNames.includes(name));
      expect(staleSamples, 'Remove sample input for unregistered MCP tools.').toEqual([]);

      expect(registeredToolNames).toEqual(sampleNames);

      for (const tool of tools) {
        const sample = toolSamples[tool.name as RegisteredToolName];
        const input = tool.inputSchema.parse(sample);
        const result = await tool.handler(input as never, context());

        expect(result.isError, `${tool.name} should complete its success path`).toBeFalsy();
        expect(fetchSpy, `${tool.name} must not fetch directly`).not.toHaveBeenCalled();
      }

      for (const resource of tribunalMcpRegistry.resources) {
        const result = await resource.handler(new URL(resource.uri), context());
        expect(
          result.contents.length,
          `${resource.name} should complete its success path`,
        ).toBeGreaterThan(0);
        expect(fetchSpy, `${resource.name} must not fetch directly`).not.toHaveBeenCalled();
      }

      expect(
        tribunalMcpRegistry.prompts,
        'Add prompt argument samples and invoke their handlers when registering prompts.',
      ).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
