# GH GitHub Write Paths and Signal Seam

Status: complete

## Done

- Added single-repository read-token minting with cache policy coverage.
- Added pull request diff context helpers for commentable lines.
- Added pull request review posting with line/side anchors and Check Run batching.
- Replaced the pull request signal stubs with idempotent `review_intent` inserts.
- Narrowed webhook deferred claiming to the lifecycle events that write durable review intents.
- Widened review-intent idempotency to delivery, kind, repository, and pull request scope.
- Ran `bun run --cwd packages/github test:coverage:review-engine`; it passed with 100 percent line and function coverage for the review-engine GitHub slice.

## Left

- None for this track.

## Failures

- Adversarial review found the original idempotency scope was too broad and the deferred filter was wider than the durable mapper. Both issues are fixed and covered by tests.

<promise>TRACK_GH_DONE</promise>
