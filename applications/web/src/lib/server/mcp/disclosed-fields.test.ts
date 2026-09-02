import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { tribunalMcpOperations, type TribunalMcpOperationName } from './registry';
import { tribunalScopeVocabulary, type TribunalMcpScope } from './scope-vocabulary';

vi.mock('$env/dynamic/private', () => ({ env: { MCP_SERVER_NAME: 'tribunal-mcp-server' } }));

/**
 * Every field each tool discloses, written out.
 *
 * This file exists because one defect class kept recurring through review: a
 * projection returning something its scope's consent sentence does not
 * describe. It happened with a review run's trigger and reviewed commit, a
 * finding's agent identity, a cost event's review-run id, and a repository's
 * installation account — four separate times, each caught by a reviewer rather
 * than by a test, because nothing tied the shape of an output to the sentence
 * the user approved.
 *
 * Pinning the field lists turns that into a visible diff. Adding a field to a
 * tool now fails here until somebody writes it down next to the consent copy
 * it has to be covered by, which is exactly the moment to notice it is not.
 *
 * The consent text is quoted rather than imported so a change to either side
 * has to be reconciled by hand. Two copies that must agree, with a test
 * between them, is the point.
 */
const disclosedFields: Record<
  TribunalMcpOperationName,
  { scope: TribunalMcpScope; consent: string; fields: string[] }
> = {
  list_repositories: {
    scope: 'repositories:read',
    consent: 'name, owner, default branch, and latest commit',
    fields: ['repositories', 'limit', 'offset', 'hasMore'],
  },
  get_repository: {
    scope: 'repositories:read',
    consent: 'name, owner, default branch, and latest commit',
    fields: ['repository'],
  },
  list_pull_requests: {
    scope: 'pull_requests:read',
    consent: 'title, description, author, branch names, commit SHAs, link, timestamps',
    fields: ['repositoryId', 'pullRequests', 'page', 'perPage', 'hasNextPage'],
  },
  get_pull_request: {
    scope: 'pull_requests:read',
    consent:
      'title, description, author, branch names, commit SHAs, link, timestamps, changed-file and line counts, comment and commit counts, and the CI, review, and merge status',
    fields: ['repositoryId', 'pullRequest'],
  },
  list_review_runs: {
    scope: 'reviews:read',
    consent: 'the status, timing, and cost estimate',
    fields: ['runs', 'limit', 'offset', 'hasMore'],
  },
  get_review_run: {
    scope: 'reviews:read',
    consent: 'the status, timing, and cost estimate',
    fields: ['run'],
  },
  list_review_findings: {
    scope: 'review_findings:read',
    consent: 'severity, file location, and suggested fixes',
    fields: ['findings', 'limit', 'offset', 'hasMore'],
  },
  get_review_finding: {
    scope: 'review_findings:read',
    consent: 'severity, file location, and suggested fixes',
    fields: ['finding'],
  },
  list_cost_events: {
    scope: 'cost_events:read',
    consent: 'estimated review costs by repository and agent',
    fields: ['costEvents', 'limit', 'offset', 'hasMore'],
  },
  get_cost_summary: {
    scope: 'cost_events:read',
    consent: 'estimated review costs by repository and agent',
    fields: ['source', 'windowDays', 'since', 'eventCount', 'totalUsd', 'byRepository', 'byAgent'],
  },
};

/** The nested shapes, where the fields a scope discloses actually live. */
const disclosedNestedFields: Record<string, string[]> = {
  repository: ['id', 'owner', 'name', 'defaultBranch', 'latestCommit'],
  pullRequestSummary: [
    'number',
    'title',
    'state',
    'isDraft',
    'authorLogin',
    'headRef',
    'headSha',
    'baseRef',
    'htmlUrl',
    'updatedAt',
    'mergedAt',
  ],
  reviewRun: [
    'id',
    'status',
    'repositoryId',
    'repositoryOwner',
    'repositoryName',
    'pullRequestNumber',
    'costEstimateUsd',
    'startedAt',
    'finishedAt',
  ],
  finding: [
    'id',
    'runId',
    'repositoryId',
    'repositoryOwner',
    'repositoryName',
    'pullRequestNumber',
    'path',
    'startLine',
    'endLine',
    'side',
    'severity',
    'title',
    'body',
    'suggestion',
    'verificationStatus',
    'createdAt',
  ],
  pullRequestDetail: [
    'number',
    'title',
    'state',
    'isDraft',
    'authorLogin',
    'headRef',
    'headSha',
    'baseRef',
    'htmlUrl',
    'updatedAt',
    'mergedAt',
    'description',
    'additions',
    'deletions',
    'changedFiles',
    'isMerged',
    'commentCount',
    'reviewCommentCount',
    'commitCount',
    'operationalState',
  ],
  operationalState: [
    'state',
    'isDraft',
    'isMerged',
    'headSha',
    'baseSha',
    'baseRef',
    'ciStatus',
    'failingCheckCount',
    'ciUpdatedAt',
    'reviewStatus',
    'approvalCount',
    'changesRequestedCount',
    'unresolvedThreadCount',
    'reviewUpdatedAt',
    'mergeStatus',
    'mergeUpdatedAt',
    'pullRequestUpdatedAt',
    'describesCurrentHead',
  ],
  costEvent: [
    'occurredAt',
    'amountUsd',
    'source',
    'repositoryId',
    'repositoryOwner',
    'repositoryName',
    'agentSlug',
  ],
};

function outputKeysOf(operation: TribunalMcpOperationName): string[] {
  const schema = tribunalMcpOperations[operation].outputSchema as
    z.ZodObject<z.ZodRawShape> | undefined;
  return schema ? Object.keys(schema.shape) : [];
}

function nestedKeysOf(operation: TribunalMcpOperationName, path: string[]): string[] {
  let schema = tribunalMcpOperations[operation].outputSchema as z.ZodObject<z.ZodRawShape>;
  for (const segment of path) {
    let next = schema.shape[segment] as z.ZodType;
    // Unwrap arrays and nullables so the assertion reads the element shape.
    for (;;) {
      const definition = (
        next as unknown as {
          _zod?: { def?: { type?: string; element?: z.ZodType; innerType?: z.ZodType } };
        }
      )._zod?.def;
      if (definition?.type === 'array' && definition.element) next = definition.element;
      else if (definition?.innerType) next = definition.innerType;
      else break;
    }
    schema = next as z.ZodObject<z.ZodRawShape>;
  }
  return Object.keys(schema.shape);
}

describe('disclosed fields', () => {
  it.each(Object.keys(disclosedFields) as TribunalMcpOperationName[])(
    '%s returns exactly the fields recorded against its consent copy',
    (operation) => {
      expect.assertions(2);
      const expected = disclosedFields[operation];

      expect(outputKeysOf(operation).sort()).toEqual([...expected.fields].sort());
      expect(tribunalMcpOperations[operation].requiredScope).toBe(expected.scope);
    },
  );

  it('quotes consent copy that the vocabulary actually contains', () => {
    expect.assertions(10);

    for (const [operation, expected] of Object.entries(disclosedFields)) {
      // A quoted phrase that has drifted out of the consent screen is worse
      // than no quote: it makes a stale expectation look reviewed.
      expect(
        tribunalScopeVocabulary.descriptions[expected.scope],
        `${operation} quotes copy that is no longer in the consent text`,
      ).toContain(expected.consent);
    }
  });

  it('discloses only the repository identity fields the consent sentence names', () => {
    expect.assertions(2);

    // Not `installationAccount`, and not `installationId`: the first is the
    // account an installation belongs to, which can differ from the
    // repository's owner, and the second is how the server picks a client.
    expect(nestedKeysOf('get_repository', ['repository']).sort()).toEqual(
      [...disclosedNestedFields.repository].sort(),
    );
    expect(nestedKeysOf('list_repositories', ['repositories']).sort()).toEqual(
      [...disclosedNestedFields.repository].sort(),
    );
  });

  it('discloses only pull request fields the consent sentence names', () => {
    expect.assertions(3);

    expect(nestedKeysOf('list_pull_requests', ['pullRequests']).sort()).toEqual(
      [...disclosedNestedFields.pullRequestSummary].sort(),
    );
    // The detail shape and its nested stored state are pinned separately.
    // Traversing only the summary left the fields unique to `get_pull_request`
    // — and every field of `operationalState`, which is where Tribunal's own
    // recorded data lives — outside a gate that claims to cover all of them.
    expect(nestedKeysOf('get_pull_request', ['pullRequest']).sort()).toEqual(
      [...disclosedNestedFields.pullRequestDetail].sort(),
    );
    expect(nestedKeysOf('get_pull_request', ['pullRequest', 'operationalState']).sort()).toEqual(
      [...disclosedNestedFields.operationalState].sort(),
    );
  });

  it('discloses only review run lifecycle fields', () => {
    expect.assertions(1);

    // Not the trigger, and not the reviewed commit: `reviews:read` covers
    // status, timing, and cost estimate.
    expect(nestedKeysOf('get_review_run', ['run']).sort()).toEqual(
      [...disclosedNestedFields.reviewRun].sort(),
    );
  });

  it('discloses only finding fields, never the agent that reported one', () => {
    expect.assertions(1);

    expect(nestedKeysOf('get_review_finding', ['finding']).sort()).toEqual(
      [...disclosedNestedFields.finding].sort(),
    );
  });

  it('discloses only spending fields, never review metadata', () => {
    expect.assertions(2);

    // Not `reviewRunId`: a review run identifier is review metadata, and
    // `reviews:read` is separately refusable.
    expect(nestedKeysOf('list_cost_events', ['costEvents']).sort()).toEqual(
      [...disclosedNestedFields.costEvent].sort(),
    );
    // The repository rollup carries the identity it grouped by, so two
    // repositories sharing an owner/name cannot be merged into one amount.
    expect(nestedKeysOf('get_cost_summary', ['byRepository']).sort()).toEqual([
      'amountUsd',
      'label',
      'repositoryId',
    ]);
  });
});
