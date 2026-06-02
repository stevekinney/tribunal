---
name: learning-maintenance
description: >
  Promote learning markdown files into durable project documentation and delete
  processed learning files. Use when `documentation/learnings/*.md` has
  entries that should update canonical domain skills (`component-standards`,
  `database-operations`, `github-integration-rules`,
  `markdown-security`), other `.claude/skills/**/SKILL.md`, `.claude/rules/*.md`,
  `AGENTS.md`, `CLAUDE.md`, `README.md`, and other `README.md` files.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(bun*run .claude/skills/learning-maintenance/scripts/list-context.ts:*), Bash(git status:*), Bash(git diff:*), Bash(rm:*)
---

# Learning Maintenance

Promote durable learnings into repository docs, then prune processed learning files.

## Context

!`bun --cwd "$(git rev-parse --show-toplevel)" run .claude/skills/learning-maintenance/scripts/list-context.ts`

Use the generated list as the source of truth for:
- Pending learning files.
- Documentation surfaces that can be updated.

For durable-vs-ephemeral triage, use `.claude/skills/learning-maintenance/references/promotion-rubric.md`.

## Workflow

1. Process pending learning files in lexical order (oldest first).
2. Read one learning file and extract only durable guidance.
3. Map each durable item to the smallest correct target:
   - Canonical domain skills for domain behavior:
     - `component-standards`
     - `database-operations`
     - `github-integration-rules`
     - `markdown-security`
   - Other `.claude/skills/**/SKILL.md` files for workflow/process behavior.
   - `.claude/rules/*.md` for codified guardrails.
   - `AGENTS.md` / `CLAUDE.md` for top-level agent behavior.
   - `README.md` files for discoverability and operational usage notes.
4. Edit documentation with minimal diffs:
   - Merge with existing bullets rather than duplicating language.
   - Keep guidance imperative and specific.
   - Remove stale references encountered during promotion.
5. Confirm the documentation edits reflect the learning.
6. Delete the processed learning file from `documentation/learnings/`.
7. Repeat until no pending markdown learning files remain.
8. Verify final state with `git status --short` and summarize:
   - Documentation files updated.
   - Learning files deleted.
   - Any skipped files and why.

## Safety Boundaries

- Do not broaden scope beyond documentation and processed learning-file deletion.
- Do not delete a learning file before durable guidance is reflected in docs (or explicitly judged non-durable).
- If a learning conflicts with existing documented policy, update the policy only when the learning is repeated or clearly authoritative.
