# PR-490 Claude CLI review feedback — round 1

- When parsing line-delimited stream output, preserve a separate raw stdout buffer for error reporting. Consuming parsed lines from a working buffer causes non-zero exit errors to lose the most useful diagnostics.
- Emit subagent lifecycle completion events from `user.tool_use_result` only when task-scoped identifiers are present (for example `task_id`). Treating all tool results as task completions creates false lifecycle events.
- If explicit pre-tool safety hooks are removed, do not keep fully permissive execution (`bypassPermissions` plus dangerous-skip flags) in unattended flows. Prefer a safer CLI permission mode so policy enforcement is not advisory-only.
