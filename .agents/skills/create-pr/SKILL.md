---
name: create-pr
description: Create or update a GitHub pull request with ticket context, synchronized branch history, and a concrete test plan.
context: fork
agent: git-ninja
allowed-tools: Read, Grep, Glob, AskUserQuestion, mcp__linear__get_issue, mcp__linear__update_issue, mcp__linear__create_comment, Bash(bun*run scripts/extract-ticket-from-branch.ts:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*), Bash(git rebase:*), Bash(git merge:*), Bash(git log:*), Bash(git diff:*), Bash(git push:*), Bash(gh pr:*), Bash(gh api:*), Bash(bun run check:*)
---

# Create Pull Request

Be sure to prefix the pull request title with the ticket identifier.

## When to use

- Create a pull request from a ready branch.
- Update an existing pull request body when branch context changed.

## Preflight

1. **Identify ticket context** — Use `TICKET` if supplied, otherwise extract from branch:

!`bun --cwd "$(git rev-parse --show-toplevel)" run scripts/extract-ticket-from-branch.ts`

2. **Verify repository state**:

!`git status`
!`git branch --show-current`

If the working tree is not clean, stop and commit first using `/commit`.

3. **Sync with the latest `origin/main` before creating the pull request**:

!`git fetch origin`

You must sync the branch with the latest `origin/main` using the best strategy for the current state (for example: rebase, fast-forward merge, or merge).
Complete this sync before opening or updating the pull request.

4. **Validate pull request readiness**:

```bash
git log origin/main..HEAD --oneline
bun run check
```

Do not open or update a pull request while local checks fail.

## Gather Context

If Linear MCP is available, fetch ticket details:

```
mcp__linear__get_issue({ id: "TEAM-27" })
```

Extract:

- Title and description for PR context
- Acceptance criteria for test plan
- Related tickets to mention

## PR Format

**Title format:** `TEAM-XX: Brief description`

```bash
gh pr create --title "TEAM-27: Add user profile settings" --body "$(cat <<'EOF'
## Summary

Brief description of what this PR does.

- Bullet points of key changes

## Linear

Closes TEAM-27

## Test plan

- [ ] Manual testing steps
- [ ] Automated tests added/updated
EOF
)"
```

If a pull request already exists for the branch, update it instead of creating a duplicate:

```bash
gh pr edit --title "TEAM-27: Add user profile settings" --body-file /tmp/pull-request-body.md
```

## Checklist

Before creating or updating the pull request:

- [ ] Ticket ID in PR title
- [ ] Ticket ID in PR body (Closes/Fixes/Relates to)
- [ ] Summary describes the "why"
- [ ] Test plan is actionable
- [ ] Branch synced with latest `origin/main`
- [ ] `bun run check` passes locally
- [ ] Codex MCP code review completed and all requested changes addressed

## Branch Naming

If creating a new branch, include the ticket:

```bash
git checkout -b feature/TEAM-27-brief-description
```

## After PR Creation

If Linear MCP is available, update the ticket:

- Add comment with PR link
- Update status if appropriate

## Alignment with other commands

- `/commit`: produce clean, focused commits before this command.
- `/create-pr`: requires a synced branch and passing local checks before opening or updating a pull request.
- `/address-pr`: follows the same sync-first approach and commit quality standards while resolving feedback.

## Codex MCP review gate

Before opening or updating a pull request, run a Codex MCP code review and address all requested changes.
