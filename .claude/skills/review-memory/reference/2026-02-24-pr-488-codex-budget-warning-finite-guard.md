# PR 488 — Codex budget warning finite-value guard

## Durable learnings

- When formatting numeric budget values for diagnostics or warnings, guard with `Number.isFinite` before applying fixed-point formatting. Non-finite values (`Infinity`, `-Infinity`, `NaN`) should be treated as absent for warning text instead of emitting misleading strings.
