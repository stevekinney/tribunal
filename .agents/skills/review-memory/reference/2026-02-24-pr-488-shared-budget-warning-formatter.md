# PR 488 — Shared finite-budget warning formatter

## Durable learnings

- When parallel pipeline paths need identical safety formatting logic (for example `Number.isFinite` guards around budget warning values), centralize the formatter in a shared module rather than duplicating helper functions across entry points. This prevents drift and removes repeated bug-fix loops.
