---
date: 2026-06-19
source: pull-request-review
scope: cost-reconciliation
---

# Cost Report Mixed Attribution

- Mixed organization cost-report responses can contain both attributable and unscoped positive rows.
- Skip unscoped rows when attributable rows exist so they do not duplicate across review runs or block valid reconciliation.
- Fail loudly only when every positive USD row is unscoped, which makes unsupported reconciliation explicit without discarding valid rows.
