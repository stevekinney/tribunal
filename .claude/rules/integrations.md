---
paths:
  - src/lib/server/linear-*.ts
  - src/lib/server/workspace-integrations.ts
---

# Integration helpers

- Use `getWorkspaceIntegration(workspaceId, provider)` instead of duplicating workspace integration lookup queries to keep behavior consistent.
