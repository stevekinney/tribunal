# CM Cost Metering and Reconciliation

Status: complete

## Done

- Added `@tribunal/cost` with versioned pricing and sandbox cost calculation.
- Added idempotent sandbox estimate recording on `sandbox:<id>:<window>`.
- Added LLM estimate recording and a `CostPort` adapter.
- Added fakeable Usage and Cost API reconciliation that writes `source='reconciled'` rows while preserving estimates.
- Added daily cap enforcement over estimate rows.
- Added run rollups for estimate, reconciled, and delta amounts.
- Ran `bun run --cwd packages/cost test:coverage`; it passed with 100 percent line and function coverage.
- Ran `bun run verify`; it passed.

## Left

- None for this track.

## Failures

- None.

<promise>TRACK_CM_DONE</promise>
