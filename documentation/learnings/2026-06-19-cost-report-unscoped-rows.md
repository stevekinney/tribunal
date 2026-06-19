---
date: 2026-06-19
source: pull-request-review
scope: cost-reconciliation
---

# Cost Report Unscoped Rows

- Organization-level cost report rows must not be attributed to a review run unless the row carries explicit review-run metadata.
- When an external cost API cannot safely attribute charge rows, fail reconciliation loudly instead of inserting target-scoped synthetic events.
- Keep cost parser helpers explicit: non-positive or malformed amounts should return `NaN` so callers make the skip decision in one place.
