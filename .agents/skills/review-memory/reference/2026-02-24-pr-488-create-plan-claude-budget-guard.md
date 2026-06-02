# PR 488 — create-plan phase budget guard

## Durable learnings

- When a runtime adapter accepts provider-specific option objects, pass budget fields only for the provider that enforces them (for example `provider === 'claude'` for `maxBudgetUsd`) to avoid duplicate warning paths.
- If top-level orchestration already warns that codex ignores USD budgets, phase-level runners must not forward budget overrides into provider options that trigger another warning.
- Keep budget-option spread patterns aligned across pipeline modules (`create-plan`, `execute-plan`, `address-pr`) so provider behavior is consistent and review regressions are easier to detect.
