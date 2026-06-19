---
date: 2026-06-19
source: pull-request-review
scope: cost-reconciliation
---

# Cost Reconciliation Attribution Window

- Port-written sandbox cost rows should carry the same billing `window` metadata as the ledger helper so audit data stays consistent across call paths.
- Anthropic organization cost reports are aggregated rows; reconciliation clients should receive the local review-run target window and ownership context instead of requiring per-row custom metadata to exist.
