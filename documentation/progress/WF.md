# WF Workflows and Engine

Status: complete for local durable workflow runtime

## Done

- Added the engine workflow foundation with deterministic identifiers, fakeable review workflow ports, and lifecycle tests.
- Added coverage gating for the engine implementation.
- Added fakeable workflow hardening for duplicate start intents, duplicate synchronize signals, mid-run supersession, pull request close teardown, retry-safe posting, quota-blocked runs, singleton lock acquisition, and sandbox reaping.
- Composed the real review-intent consumer into the Weft runtime with registered `review-pr`, `review-run`, `agent-review`, and `sandbox-reaper` workflows.
- Added claim release coverage for downstream processing and bound workflow dispatch failures.
- Added runtime GitHub diff metadata fetching and sandbox cancellation race coverage.
- Ran `bun run --cwd applications/engine test:coverage`; it passed with 100 percent line and function coverage for the current engine slice.

## Left

- None for local implementation. Live deployment validation remains tracked in Track D.

## Failures

- None yet.

<promise>TRACK_WF_DONE</promise>
