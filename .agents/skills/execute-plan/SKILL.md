---
name: execute-plan
description: Read PLAN.md, create an agent team, and execute the implementation plan using recommended subagents.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskGet, TaskList, SendMessage, mcp__linear__get_issue, mcp__linear__update_issue
agent: grand-planner
---

# Execute Plan

Read PLAN.md and orchestrate implementation using an agent team with the recommended subagents.

## Prerequisites

- A plan file must exist at `PLAN.md` by default, or `plans/<ticket>-multi-agent-plan.md` when a `plans/` directory is present.
- The plan should contain a **Task Index** table in seven-column format (`Task ID | Title | Agent | Phase | Depends On | Complexity | Status`), followed by **Task Definitions** sections with per-task details.

## Plan Content

!`cat PLAN.md 2>/dev/null || { ls plans/*-multi-agent-plan.md >/dev/null 2>&1 && cat plans/*-multi-agent-plan.md | head -1000; } || echo "ERROR: No plan file found. Create a PLAN.md first."`

## Phase 1: Validate the Plan

1. Confirm PLAN.md exists and was injected into context.
2. Extract:
   - **Ticket identifier**: First, extract from the plan title (e.g., `TICKET-123`).
     If the title has no ticket ID, extract from the current branch name:
     ```bash
     git branch --show-current
     ```
     Branch names follow `<ticket>/TICKET-<number>-*` or `TICKET-<number>-*`.
   - **Task Index table** — the seven-column `Task ID | Title | Agent | Phase | Depends On | Complexity | Status` table.
   - **Task Definitions** — per-task sections with agent, phase, complexity, description, acceptance criteria, and file inventory.
   - **Implementation Approach** — the step-by-step plan.
   - **Acceptance Criteria** — what must be true when done.
3. If the plan has **no Task Index table** (or the table is empty):
   - Inform the user that no team is needed.
   - Offer to implement the plan directly in the current session.
   - Stop here — do not create a team.
4. Parse each row of the Task Index into a task record: `{ taskId, title, agent, phase, dependsOn, complexity, status }`.

## Phase 2: Create Team and Tasks

1. **Create the team** using `TeamCreate`:
   - Team name: `{ticket-id}-implementation` (e.g., `ticket-123-implementation`). Use lowercase.
   - Description: `Implementing {ticket-id}: {plan title}`.

2. **Create one task per table row** using `TaskCreate`:
   - `subject`: The task description from the table.
   - `description`: Include the full task description, plus relevant sections from the plan:
     - The specific Implementation Approach steps that relate to this task.
     - Key file paths or patterns the agent should follow.
   - `activeForm`: A present-continuous summary (e.g., "Adding migration for new columns").

3. **Set up dependencies** using `TaskUpdate`:
   - For tasks with `none` in the Depends On column: no `blockedBy`.
   - For tasks with specific task IDs (e.g., `T-1, T-2`): set `blockedBy` to those task IDs.
   - Tasks within the same phase should have no dependencies on each other unless explicitly listed.

4. **Create a final verification task** owned by the orchestrator:
   - Subject: "Verify implementation and run type-check".
   - Blocked by all other tasks.

## Phase 3: Spawn Teammates and Start Work

1. **Spawn one teammate per unique agent name** in the Task Index using the `Task` tool:
   - Use the agent name from the table as the `subagent_type` (e.g., `svelte-expert`, `database-architect`).
   - Use the agent name as the teammate `name`.
   - Set `team_name` to the team created in Phase 2.
   - The teammate prompt should instruct them to:
     - Check `TaskList` for tasks assigned to them.
     - Work on assigned tasks, marking them `in_progress` then `completed`.
     - After completing a task, check `TaskList` for newly available work.
     - Send a message to the orchestrator when stuck or when all their tasks are done.

2. **Assign Phase 1 (unblocked) tasks** to the appropriate teammates using `TaskUpdate` with `owner`.

3. **Send each teammate their initial context** via `SendMessage`:
   - The specific task they should start with.
   - Key constraints or patterns from the Implementation Approach.

## Phase 4: Monitor and Coordinate

Run an event-driven coordination loop:

1. **When a teammate completes a task:**
   - Check `TaskList` for newly unblocked tasks (tasks whose `blockedBy` dependencies are all completed).
   - Assign newly unblocked tasks to the appropriate teammate via `TaskUpdate`.
   - Send the teammate context for their next task via `SendMessage`.

2. **When a teammate reports a problem:**
   - If it is a question about the plan, provide clarification from PLAN.md context.
   - If it requires information from another teammate's work, relay the context.
   - If it is a blocking issue, escalate to the user with `AskUserQuestion`.

3. **When a teammate has no remaining tasks:**
   - Send a `shutdown_request` to that teammate.
   - Do not keep idle teammates running.

4. **Continue until all implementation tasks are completed** (only the verification task remains).

## Phase 5: Verify and Cleanup

1. **Run type-checking:** `bun run check`.
2. **Walk the Acceptance Criteria** from PLAN.md:
   - For each criterion, verify it is satisfied by the implementation.
   - Note any criteria that are not fully met.
3. **Update PLAN.md** progress section:
   - Mark completed tasks.
   - Note any issues or remaining work.
4. **Shut down all remaining teammates** via `shutdown_request`.
5. **Delete the team** using `TeamDelete`.
6. **Report to the user:**
   - Summary of what was implemented.
   - Files touched by the team.
   - Type-check results.
   - Any acceptance criteria not fully met.
   - Prompt with next steps: `/pr:create`, review changes manually, or continue with additional work.

## Safety Boundaries

- **Do not commit** unless the user explicitly asks.
- **Do not update Linear ticket status** automatically — report to the user and let them decide.
- **Shut down all teammates before ending.** No orphan processes.
- **Respect the plan.** Only assign tasks that come from the Task Index. If additional work is discovered, inform the user and add it to the task list with their approval.
- **One task at a time per teammate.** Do not assign a second task until the first is completed.
- **Do not force-push, reset, or clean** the working tree.

## Error Recovery

- **TeamCreate failure:** Inform the user. Suggest checking that team features are available, or offer to implement the plan directly without a team.
- **Unknown agent name in the table:** Skip that agent's tasks. Warn the user that those tasks will need manual implementation. Continue with the agents that are available.
- **Teammate fails a task:** Capture the error context. Attempt reassignment or offer to implement that task directly. Update PLAN.md with failure notes.
- **All teammates fail:** Update PLAN.md with failure notes for each task. Suggest the user implement manually or retry specific tasks.
- **Context compaction:** PLAN.md is re-injected via the existing hook. Use `TaskList` to recover current state — task statuses persist across compactions.
- **All failure paths above:** Before stopping or escalating, write a reflection file to `documentation/pipeline-reflections/YYYY-MM-DD-execute-<ticket-or-context>.md`.
  - Use the ticket identifier extracted in Phase 1 when available; otherwise use a kebab-case description.
  - If the filename already exists, append a numeric suffix (`-2`, `-3`, ...).
  - Follow the template in `documentation/pipeline-reflections/TEMPLATE.md`. Include the raw error output, the current PLAN.md state, which phase failed, and which tasks (if any) completed before the failure.
  - Write the file before shutting down teammates or deleting the team. This is mandatory.

## Verification

- All tasks from the Task Index are completed or accounted for.
- `bun run check` passes.
- Acceptance criteria from PLAN.md are walked and verified.
- All teammates are shut down and the team is deleted.
- PLAN.md progress section is updated with completed work.
- If the pipeline failed, a `documentation/pipeline-reflections/` file was written.
