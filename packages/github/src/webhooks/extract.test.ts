import { describe, expect, it } from 'vitest';
import {
  createPushEvent,
  createCheckRunCompletedEvent,
  createCheckSuiteCompletedEvent,
  createPullRequestOpenedEvent,
  createPullRequestReviewThreadResolvedEvent,
  createIssueCommentCreatedEvent,
} from 'github-webhook-schemas/fixtures';
import { extractEventFields, getRepositoryIdentity } from './extract.js';
import type { WebhookPayload } from './types.js';

describe('extractEventFields', () => {
  it('extracts prNumber for pull_request_review_thread events (resolved/unresolved)', () => {
    // A `pull_request_review_thread` payload has no shared type guard the way
    // `pull_request_review`/`pull_request_review_comment` do here, so this
    // exercises the structural fallback branch -- the case that was entirely
    // missing before this fix, which meant listener filters on `prNumber`
    // could never match these events (see `event-listener-matching.ts`,
    // which reads the normalized `prNumber` field this function produces).
    const data = {
      action: 'resolved',
      pull_request: { number: 42 },
    } as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request_review_thread', data);

    expect(fields.prNumber).toBe(42);
  });

  it('extracts prNumber for the unresolved action too', () => {
    const data = {
      action: 'unresolved',
      pull_request: { number: 7 },
    } as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request_review_thread', data);

    expect(fields.prNumber).toBe(7);
  });

  it('does not throw and extracts nothing when pull_request is missing', () => {
    const data = { action: 'resolved' } as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request_review_thread', data);

    expect(fields.prNumber).toBeUndefined();
  });

  it('extracts prNumber via the typed guard for a schema-valid resolved event', () => {
    const data = createPullRequestReviewThreadResolvedEvent({
      pull_request: { number: 42 },
    }) as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request_review_thread', data);

    expect(fields.prNumber).toBe(42);
  });
});

describe('extractEventFields (issue_comment)', () => {
  // Exercises the structural-fallback branch (no shared type guard covers
  // `edited`/`deleted` issue_comment actions) -- same code path the
  // `created`-action guard branch shares for the `issue.pull_request` check.
  it('extracts issueNumber only for a comment on a plain issue', () => {
    const data = {
      action: 'edited',
      issue: { number: 42 },
    } as unknown as WebhookPayload;

    const fields = extractEventFields('issue_comment', data);

    expect(fields.issueNumber).toBe(42);
    expect(fields.prNumber).toBeUndefined();
  });

  it('also populates prNumber when the issue comment is on a pull request', () => {
    // GitHub represents pull requests as issues for issue_comment events: a
    // comment on a PR carries `issue.pull_request`, and `issue.number` IS the
    // PR number. A listener filtering on `prNumber` must be able to match
    // these -- without this, PR comments could never match a `prNumber`
    // filter (see `event-listener-matching.ts`).
    const data = {
      action: 'edited',
      issue: { number: 42, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/42' } },
    } as unknown as WebhookPayload;

    const fields = extractEventFields('issue_comment', data);

    expect(fields.issueNumber).toBe(42);
    expect(fields.prNumber).toBe(42);
  });

  it('does not throw and extracts nothing when issue is missing', () => {
    const data = { action: 'edited' } as unknown as WebhookPayload;

    const fields = extractEventFields('issue_comment', data);

    expect(fields.issueNumber).toBeUndefined();
    expect(fields.prNumber).toBeUndefined();
  });

  it('extracts issueNumber via the typed guard for a schema-valid created comment on a plain issue', () => {
    const data = createIssueCommentCreatedEvent({
      issue: { number: 42 },
    }) as unknown as WebhookPayload;

    const fields = extractEventFields('issue_comment', data);

    expect(fields.issueNumber).toBe(42);
    expect(fields.prNumber).toBeUndefined();
  });

  it('extracts prNumber via the typed guard for a schema-valid created comment on a pull request', () => {
    const data = createIssueCommentCreatedEvent({
      issue: { number: 42, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/42' } },
    }) as unknown as WebhookPayload;

    const fields = extractEventFields('issue_comment', data);

    expect(fields.issueNumber).toBe(42);
    expect(fields.prNumber).toBe(42);
  });
});

describe('extractEventFields (pull_request)', () => {
  it('extracts prNumber and githubCreatedAt for opened/closed events (typed guard branch)', () => {
    const data = createPullRequestOpenedEvent({
      pull_request: { number: 42, created_at: '2024-01-15T10:00:00Z' },
    }) as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request', data);

    expect(fields.prNumber).toBe(42);
    expect(fields.githubCreatedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
  });

  it('extracts prNumber structurally for actions with no matching guard (e.g. synchronize)', () => {
    const data = {
      action: 'synchronize',
      pull_request: { number: 7 },
    } as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request', data);

    expect(fields.prNumber).toBe(7);
    expect(fields.githubCreatedAt).toBeUndefined();
  });

  it('extracts nothing when pull_request is missing', () => {
    const data = { action: 'synchronize' } as unknown as WebhookPayload;

    const fields = extractEventFields('pull_request', data);

    expect(fields.prNumber).toBeUndefined();
  });
});

describe('extractEventFields (pull_request_review / pull_request_review_comment)', () => {
  it('extracts prNumber for pull_request_review events', () => {
    const data = {
      action: 'submitted',
      pull_request: { number: 11 },
    } as unknown as WebhookPayload;

    expect(extractEventFields('pull_request_review', data).prNumber).toBe(11);
  });

  it('extracts nothing for pull_request_review events with no pull_request', () => {
    const data = { action: 'submitted' } as unknown as WebhookPayload;

    expect(extractEventFields('pull_request_review', data).prNumber).toBeUndefined();
  });

  it('extracts prNumber for pull_request_review_comment events', () => {
    const data = {
      action: 'created',
      pull_request: { number: 12 },
    } as unknown as WebhookPayload;

    expect(extractEventFields('pull_request_review_comment', data).prNumber).toBe(12);
  });

  it('extracts nothing for pull_request_review_comment events with no pull_request', () => {
    const data = { action: 'created' } as unknown as WebhookPayload;

    expect(extractEventFields('pull_request_review_comment', data).prNumber).toBeUndefined();
  });
});

describe('extractEventFields (issues)', () => {
  it('extracts issueNumber and githubCreatedAt', () => {
    const data = {
      action: 'opened',
      issue: { number: 5, created_at: '2024-02-01T00:00:00Z' },
    } as unknown as WebhookPayload;

    const fields = extractEventFields('issues', data);

    expect(fields.issueNumber).toBe(5);
    expect(fields.githubCreatedAt).toEqual(new Date('2024-02-01T00:00:00Z'));
  });

  it('extracts issueNumber without githubCreatedAt when created_at is absent', () => {
    const data = { action: 'opened', issue: { number: 5 } } as unknown as WebhookPayload;

    const fields = extractEventFields('issues', data);

    expect(fields.issueNumber).toBe(5);
    expect(fields.githubCreatedAt).toBeUndefined();
  });

  it('extracts nothing when issue is missing', () => {
    const data = { action: 'opened' } as unknown as WebhookPayload;

    expect(extractEventFields('issues', data).issueNumber).toBeUndefined();
  });
});

describe('extractEventFields (push)', () => {
  it('extracts ref and commitSha for a valid push event', () => {
    const data = createPushEvent({
      ref: 'refs/heads/main',
      head_commit: {
        id: 'a'.repeat(40),
        tree_id: 'b'.repeat(40),
        distinct: true,
        message: 'a commit',
        timestamp: '2024-01-01T00:00:00Z',
        url: 'https://github.com/acme/widgets/commit/' + 'a'.repeat(40),
        author: { name: 'octocat', email: 'octocat@example.com' },
        committer: { name: 'octocat', email: 'octocat@example.com' },
        added: [],
        modified: [],
        removed: [],
      },
    }) as unknown as WebhookPayload;

    const fields = extractEventFields('push', data);

    expect(fields.ref).toBe('refs/heads/main');
    expect(fields.commitSha).toBe('a'.repeat(40));
  });

  it('extracts nothing for a payload that does not satisfy the push event guard', () => {
    const data = { ref: 'refs/heads/main' } as unknown as WebhookPayload;

    const fields = extractEventFields('push', data);

    expect(fields.ref).toBeUndefined();
    expect(fields.commitSha).toBeUndefined();
  });
});

describe('extractEventFields (check_run / check_suite)', () => {
  it('extracts commitSha for check_run.completed events (typed guard branch)', () => {
    const data = createCheckRunCompletedEvent({
      check_run: { head_sha: 'sha-run-1' },
    }) as unknown as WebhookPayload;

    expect(extractEventFields('check_run', data).commitSha).toBe('sha-run-1');
  });

  it('extracts commitSha structurally for check_run actions with no matching guard', () => {
    const data = {
      action: 'created',
      check_run: { head_sha: 'sha-run-2' },
    } as unknown as WebhookPayload;

    expect(extractEventFields('check_run', data).commitSha).toBe('sha-run-2');
  });

  it('extracts nothing when check_run is missing', () => {
    const data = { action: 'created' } as unknown as WebhookPayload;

    expect(extractEventFields('check_run', data).commitSha).toBeUndefined();
  });

  it('extracts commitSha for check_suite.completed events (typed guard branch)', () => {
    const data = createCheckSuiteCompletedEvent({
      check_suite: { head_sha: 'sha-suite-1' },
    }) as unknown as WebhookPayload;

    expect(extractEventFields('check_suite', data).commitSha).toBe('sha-suite-1');
  });

  it('extracts commitSha structurally for check_suite actions with no matching guard', () => {
    const data = {
      action: 'requested',
      check_suite: { head_sha: 'sha-suite-2' },
    } as unknown as WebhookPayload;

    expect(extractEventFields('check_suite', data).commitSha).toBe('sha-suite-2');
  });

  it('extracts nothing when check_suite is missing', () => {
    const data = { action: 'requested' } as unknown as WebhookPayload;

    expect(extractEventFields('check_suite', data).commitSha).toBeUndefined();
  });
});

describe('extractEventFields (unhandled event types)', () => {
  it('returns an empty object for an event type with no extraction case', () => {
    const data = { action: 'created' } as unknown as WebhookPayload;

    expect(extractEventFields('deployment', data)).toEqual({});
  });
});

describe('getRepositoryIdentity', () => {
  it('returns null owner/repo when the payload has no repository', () => {
    const data = { action: 'opened' } as unknown as WebhookPayload;

    expect(getRepositoryIdentity(data)).toEqual({ owner: null, repo: null });
  });

  it('extracts owner and repo from repository.owner.login and repository.name', () => {
    const data = {
      repository: { name: 'widgets', owner: { login: 'acme' } },
    } as unknown as WebhookPayload;

    expect(getRepositoryIdentity(data)).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('falls back to owner.name when owner.login is absent', () => {
    const data = {
      repository: { name: 'widgets', owner: { name: 'acme' } },
    } as unknown as WebhookPayload;

    expect(getRepositoryIdentity(data)).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('falls back to splitting full_name when repository.name is absent', () => {
    const data = {
      repository: { full_name: 'acme/widgets', owner: { login: 'acme' } },
    } as unknown as WebhookPayload;

    expect(getRepositoryIdentity(data)).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('falls back to splitting full_name for owner when owner is entirely absent', () => {
    const data = {
      repository: { full_name: 'acme/widgets' },
    } as unknown as WebhookPayload;

    expect(getRepositoryIdentity(data)).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('returns nulls when neither name/owner nor full_name is present', () => {
    const data = { repository: {} } as unknown as WebhookPayload;

    expect(getRepositoryIdentity(data)).toEqual({ owner: null, repo: null });
  });
});
