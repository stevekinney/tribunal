# Tribunal Review Engine Decisions

## 2026-06-17 Foundation Dependency Pins

- `@lostgradient/weft`: `0.6.0` from npm and already present in the existing web app.
- `tensorlake`: `0.5.47` from npm.
- `@anthropic-ai/claude-agent-sdk`: `0.3.181` from npm.

The foundation workspaces pin the runtime review-engine dependencies exactly where they are introduced. Later tracks should update this file before changing any of these versions.

## 2026-06-17 Review Intent Idempotency Scope

- `review_intent` idempotency is scoped to `delivery_id`, `kind`, `repository_id`, and `pr_number`.
- GitHub can send one delivery that references more than one pull request for check events. Even though the initial durable contract only enqueues pull request lifecycle events, the database constraint should preserve pull request scope so future check-driven review intents cannot suppress sibling pull requests.
- The webhook deferred-claim filter is intentionally limited to lifecycle events that write a durable `review_intent`: `opened`, `reopened`, `ready_for_review`, `synchronize`, and `closed`. Broader review/comment/check events should only move to deferred claiming when they also persist an explicit intent kind.

## 2026-06-19 Cost Event Agent Run Index

- `cost_event_agent_run_idx` is intentionally retained in addition to the required review-run and user-time indexes.
- The index supports agent-level cost drilldowns from review run inspector views without scanning every cost event for a review run.
- This is a read-path optimization only; it does not change cost-event ownership, tenancy, or reconciliation semantics.
