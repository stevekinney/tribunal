import { describe, expect, it } from 'vitest';
import { extractEventFields } from './extract.js';
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
});
