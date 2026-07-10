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
