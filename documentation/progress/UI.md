# UI Operator UI

Status: complete with documented repository limits

## Done

- Added authenticated navigation for repositories, agents, runs, costs, settings, and the workflow inspector.
- Added repository watch settings, ignore globs, assigned agents, last-run status, and 30-day estimate UI.
- Added user-scoped server actions and tests for repository watch settings.
- Added agent editor with frozen schema validation and an `xhigh` fallback notice.
- Added runs list, run inspector timeline, blocked tool-call display, findings, superseded marker, connection state, and stop endpoint.
- Added costs page with the six rollups, estimate/reconciled toggle, today-vs-cap meter, and cache-token split.
- Added settings page for daily cap, default model, and kill switch.
- Added `WEFT_INSPECTOR` and platform-administrator gated workflow inspector shell.
- Ran `bun run --cwd applications/web test:unit:server`, `bun run --cwd applications/web test:unit:client`, `bun run --cwd applications/web check`, `bun run --cwd applications/web lint`, and Svelte MCP autofixer on every changed `.svelte` file; all passed.

## Left

- Storybook stories were not added because this checkout has no `packages/components` package or Storybook configuration. UI state coverage is represented by focused route/component tests and the exported `operatorSurfaceStates` list.
- The workflow inspector is a gated operator shell until a UI-facing Weft tail stream exists.

## Failures

- None.

<promise>TRACK_UI_DONE</promise>
