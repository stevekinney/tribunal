---
name: deep-plan
description: >
  Deeply analyze one or more existing Linear tickets through codebase exploration, domain
  expert consultation, and junior engineer validation, then write comprehensive implementation
  plans directly into each ticket's Linear description.
context: fork
allowed-tools: Read, Grep, Glob, Task, AskUserQuestion, Bash(git branch:*), Bash(git rev-parse:*), Bash(git log:*), Bash(date:*), mcp__linear__get_issue, mcp__linear__list_issues, mcp__linear__list_comments, mcp__linear__save_issue, mcp__linear__create_comment
disable-model-invocation: true
argument-hint: 'TICKET-123 [TICKET-456 TICKET-789]'
---

# Deep Plan

Analyze one or more existing Linear tickets, deeply explore the codebase, consult domain experts, iterate with junior engineer reviewers, and write comprehensive implementation plans directly into each ticket's Linear description.

This skill makes **no codebase changes**. It reads the repository and writes only to Linear.

## Phase 1: Resolve Tickets

Determine ticket IDs from one of three sources, in priority order:

1. **Argument**: Parse the argument for `TICKET-\d+` patterns (space or comma separated). Accept one or more ticket IDs.
2. **Branch name**: Extract from the current git branch:
   ```bash
   git branch --show-current
   ```
   Branch names follow `<ticket>/TICKET-<number>-*` or `TICKET-<number>-*`. Extract the `TICKET-<number>` portion.
3. **Ask the user**: If neither source yields a ticket ID:
   ```
   AskUserQuestion: "Which Linear ticket(s) should I plan? (e.g., TICKET-123 TICKET-456)"
   ```

Validate each ticket ID matches the pattern `TICKET-\d+` before proceeding.

For each ticket:

1. Fetch the ticket using `mcp__linear__get_issue`. **Capture the Linear UUID `id` field** — this is required for `save_issue` later.
2. Fetch all comments using `mcp__linear__list_comments`.
3. Record: title, description, status, priority, labels, assignee, and comment content.
4. Summarize the ticket's intent in 2-3 sentences.

## Phase 2: Quality Audit

Evaluate each ticket's existing description against quality standards. Check for the presence and strength of:

- **Summary**: States a user-visible outcome, not just an implementation task.
- **Context and goal**: Explains why the work exists with supporting links.
- **Scope and non-goals**: Explicit boundaries.
- **Constraints and assumptions**: Backwards compatibility, performance budgets, security requirements.
- **Acceptance criteria**: Scenario-based, testable (Given/When/Then or equivalent).
- **Implementation plan**: File touch map with concrete paths and changes.
- **Test plan**: Automated test expectations and manual verification steps.
- **Edge cases**: Error paths, empty states, concurrency, permissions addressed.

For each ticket, record:

- Which sections are **missing**, **weak**, or **ambiguous**.
- These gaps drive expert consultation and plan authoring.

Across all tickets, note:

- **Overlapping scope areas** where tickets touch the same files or modules.
- **Dependencies** between tickets (one must land before another).
- **Shared patterns** that should be consistent across tickets.

## Phase 3: Codebase Exploration

Build a shared understanding of the codebase that serves all tickets being planned.

1. Read project documentation:
   - `AGENTS.md`, `CLAUDE.md`
   - Relevant files under `documentation/` (start with `ARCHITECTURE.md`, `GETTING_STARTED.md`)
   - `.claude/project-context.md` if it exists
2. Based on the combined scope of all tickets, explore the files that will be modified:
   - Use Glob and Grep to find relevant modules, types, and tests.
   - Read key files to understand current implementations and patterns.
3. Build a **shared exploration context** that maps:
   - File paths → which ticket(s) they are relevant to.
   - Existing utilities, components, and patterns to reuse.
   - Established conventions that new code must follow.
4. Identify cross-ticket concerns: shared types, common infrastructure, ordering constraints.

## Phase 4: Expert Consultation

Select domain experts based on the combined scope of all tickets. Spawn them in parallel using the Task tool.

| Domain           | Agent                       | Consult when                                |
| ---------------- | --------------------------- | ------------------------------------------- |
| Svelte/SvelteKit | `svelte-expert`             | UI components, routes, runes, SSR           |
| GitHub           | `github-integration-expert` | Webhooks, Octokit, GitHub App               |
| Database         | `database-architect`        | Schema, queries, migrations, indexing       |
| Frontend         | `frontend-architect`        | Performance, rendering, bundle optimization |
| UX               | `ux-designer`               | Interaction design, accessibility           |
| Costs            | `penny-pincher`             | Model routing, budget, cost observability   |

For each expert, provide:

- The ticket summaries and requirements relevant to their domain.
- The specific files and code areas from Phase 3 relevant to their domain.
- Focused questions about implementation approach, risks, or missing requirements.

**Batch questions across tickets** when multiple tickets touch the same domain. This avoids redundant consultations and ensures consistent advice.

Only consult experts whose domain is directly involved — do not consult all of them.

Collect feedback and incorporate findings into the plan drafts.

## Phase 5: Draft and Review (Parallel Per Ticket)

Spawn one `general-purpose` subagent per ticket via the Task tool. **Launch all subagents in a single message** so they run concurrently.

Each subagent receives:

- The ticket's current description, comments, and quality audit gaps from Phase 2.
- The shared codebase exploration context from Phase 3.
- The expert consultation findings from Phase 4.
- The `references/description-plan-template.md` template structure (include full template content in the prompt).
- If multiple tickets are being planned, a summary of the other tickets' scopes to avoid contradictions.

Each subagent is instructed to:

1. **Draft a comprehensive plan** following the template. Fill every applicable section. Mark inapplicable sections as `N/A` (never delete them).
2. **Spawn a `junior-engineer` reviewer** via the Task tool to validate the plan. Iterate up to **3 times**:
   - Provide the full current plan content.
   - Ask the reviewer to evaluate whether the plan is complete and unambiguous enough to implement in one shot.
   - Ask them to list blocking concerns, missing criteria, untested edge cases, and ambiguous instructions.
   - If the reviewer says **ready**, stop iterating.
   - If **not ready**, address every blocking concern and iterate.
3. **Return the final plan markdown** as output. The subagent does NOT write to Linear.

If after 3 iterations the reviewer still has concerns, include unresolved concerns in the plan's "Open Questions" section and return the plan as-is.

## Phase 6: Write to Linear (Serial)

Once all subagents return their plans, write each plan to Linear **sequentially**. Serial writing prevents race conditions and allows review before committing.

For each ticket:

1. **Merge the plan into the existing description**:
   - Preserve any existing content that is not covered by the template sections.
   - Update structured sections in place (replace weak sections with strong ones).
   - Add missing sections from the template.
   - Do not delete content the ticket author wrote that falls outside the template structure.
2. **Write the updated description** using `mcp__linear__save_issue` with the ticket's UUID `id` and the merged `description`.
3. **Add a confirmation comment** using `mcp__linear__create_comment` with:
   - A summary of what sections were added or strengthened.
   - How many junior engineer review iterations were needed.
   - Which domain experts were consulted and key findings.
   - Any unresolved open questions.

## Phase 7: Report

Summarize the results:

1. **Tickets updated**: List each ticket ID, title, and what was added.
2. **Sections added or strengthened** per ticket.
3. **Expert consultations**: Which experts were consulted and their key recommendations.
4. **Review results**: Iterations per ticket and final reviewer verdict.
5. **Cross-ticket findings**: Dependencies, shared patterns, or ordering constraints discovered.
6. **Open questions**: Any unresolved items that need human input.
7. **Confirmation**: No codebase files were modified.

## References

- Template: `references/description-plan-template.md`
