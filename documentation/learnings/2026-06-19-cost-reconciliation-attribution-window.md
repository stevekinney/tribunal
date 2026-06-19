---
date: 2026-06-19
source: pull-request-review
scope: cost-reconciliation
---

# Cost Reconciliation Attribution Window

- Port-written sandbox cost rows should carry the same billing `window` metadata as the ledger helper so audit data stays consistent across call paths.
- Anthropic organization cost reports are aggregated rows; reconciliation clients should receive the local review-run target window and ownership context instead of requiring per-row custom metadata to exist.
- When a cost port method now owns policy lookup, remove duplicated workflow DTO fields rather than leaving stale values populated by intent builders.
- Sandbox cost metadata types should match the only supported call path: required runtime/resources inputs and no unused forward-looking fields.
- Zero-cost partial agent results can still carry useful duration, model, and usage details, so guards should reject negative or invalid costs without discarding exact zero.
