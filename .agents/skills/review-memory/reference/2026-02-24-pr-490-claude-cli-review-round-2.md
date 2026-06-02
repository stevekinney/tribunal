# PR 490: Claude CLI migration review round 2

- For Claude CLI stream lifecycle telemetry, use `system.task_started` as the source of truth for subagent starts; do not also emit starts from `assistant` Task tool-use blocks.
- Track active task identifiers per stream and emit `subagent-complete` only for `user.tool_use_result` messages whose `task_id` is currently active; ignore untracked task results.
- In unattended automation flows, default to `permissionMode: 'acceptEdits'` instead of bypass-permissions flags.
