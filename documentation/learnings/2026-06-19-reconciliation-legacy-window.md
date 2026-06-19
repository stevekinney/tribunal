---
date: 2026-06-19
source: pull-request-review
scope: cost-reconciliation
---

# Reconciliation Legacy Window

- Reconciliation should tolerate older persisted review-run rows whose `startedAt` column is null.
- Prefer a narrow fallback window from existing estimate cost events before falling back to the review-run finish time.
