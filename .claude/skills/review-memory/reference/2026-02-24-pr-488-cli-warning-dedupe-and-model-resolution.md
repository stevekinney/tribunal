# PR 488 — CLI warning dedupe and resolved-model reuse

## Durable learnings

- Avoid duplicating the same user-facing warning at multiple layers for one condition. Emit codex budget-ignore messaging in a single canonical place (execution event stream) and let CLI output consume that event.
- When configuration normalization happens at entrypoint assembly, downstream execution paths should consume the normalized value directly instead of re-running the resolver.
