# Claude Compatibility Guide

Use this file for Claude-specific workflow mechanics in this repository.

## Source of truth

- Operational coding and verification rules are defined in `AGENTS.md`.
- Keep shared policy in `AGENTS.md` to avoid drift across tools.
- Use this file only for Claude workflow details (skills, subagents, and delegation).

## Claude workflow primitives

### Skills

- Location: `.claude/skills/`
- Purpose: passive domain guidance and reusable patterns.
- Use a skill when a task matches the skill description.
- Review learnings live in `documentation/learnings/` and should be updated during review triage.
- Use `learning-maintenance` to promote accumulated learnings into durable docs and delete processed learning files.

### Workflow Skills

- Location: `.claude/skills/`
- Purpose: structured workflows invoked explicitly (for example `/address-pr`, `/sync-branch`).
- Use workflow skills for repeatable multi-step procedures (for example review flows and branch sync).

### Subagents

- Location: `.claude/agents/`
- Purpose: focused delegated work with isolated context.
- Use subagents for deep domain tasks (Svelte, database, GitHub integration).

## Decision guide

- Use main thread for end-to-end implementation and user collaboration.
- Use a skill when you need coding conventions or domain constraints.
- Use a workflow skill when the workflow is repeatable and procedural (e.g., `/address-pr`, `/execute-plan`).
- Use a subagent when the task is narrow and specialist-heavy.

## Planning and verification

- For non-trivial work: research, plan, implement, verify.
- If `PLAN.md` exists, treat it as implementation intent and keep it current.
- Before opening any pull request, run a Codex MCP code review and address all requested changes.
- Prefer consolidating duplicated helpers while addressing review feedback; update call sites instead of cloning logic.
- Final responses should include summary, touched files, and verification commands run.
- When review triage produces new learnings, add a `review-memory` reference and update the matching rule or skill.
- When review triage flags accidental artifacts (for example stray build or tool output), add a rule or ignore entry and ensure the artifacts are removed from the change set.

## Safety expectations

- Do not use destructive git commands (`reset --hard`, `clean -fdx`) unless explicitly requested.
- Do not bypass hooks or CI semantics (`--no-verify`, `HUSKY=0`, `CI=1`) unless explicitly requested.
- Ask for missing credentials or secrets only when required to proceed.

## Project pointers

- Start with `documentation/GETTING_STARTED.md` and `documentation/ARCHITECTURE.md`.
- Testing guidance: `documentation/TESTING.md`.
- The app is a SvelteKit web app (`applications/web`) backed by shared packages (`packages/*`). GitHub is the only integration: GitHub OAuth for login and a GitHub App for repository access and webhooks.
