---
paths:
  - documentation/**
---

# Documentation conventions

- Update `documentation/API.md` when adding or changing API endpoints so the endpoint tables stay current.
- For CLI docs (tables and quick-starts), keep flags in sync with the actual implementation; remove options from docs when the flag is removed in code.
- Verify every documented file path and import symbol against the current tree before merging. Do not document non-existent modules or wrong export locations.
- Keep pull request descriptions aligned with the actual diff scope. If implementation scope changes, update title/body before merge.
- For SQL snippets, verify schema/table/column names against current migrations before publishing examples.
- Avoid line-number references in docs unless generated links stay valid across file churn.
