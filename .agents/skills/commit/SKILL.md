---
name: commit
description: Stage intended changes, validate them, and create a focused commit with a clear, ticket-aware message.
context: fork
agent: git-ninja
allowed-tools: Read, Grep, Glob, AskUserQuestion, Bash(bun*run scripts/extract-ticket-from-branch.ts:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*), Bash(git rebase:*), Bash(git merge:*), Bash(git log:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(bun run check:*), Bash(bun run test:*), Bash(bun run build:*), Bash(bun run lint:*)
---

# Create Commit

Create a clean, reviewable commit with only the intended changes.

## Preflight

1. Capture repository state.
2. Identify branch and ticket context.
3. Review what is currently changed.

!`git status`
!`git branch --show-current`
!`bun --cwd "$(git rev-parse --show-toplevel)" run scripts/extract-ticket-from-branch.ts`
!`git diff --stat`

If unrelated changes are mixed in, stage only the files relevant to this commit.

If the user also asks to push as part of this workflow, sync with the latest `origin/main` using the best strategy for the current branch state (for example: rebase, fast-forward merge, or merge) before pushing.

## Commit quality standards

- One logical change per commit.
- Stage only relevant files.
- Keep commit messages explicit and scoped.
- Prefer ticket-aware commit subject when a ticket exists.

Commit subject format:

- With ticket: `TEAM-123: Imperative summary`
- Without ticket: `Imperative summary`

## Validation before commit

At minimum, run:

- `bun run check`

Also run targeted checks for touched areas when relevant:

- `bun run test`
- `bun run build`
- `bun run lint`

Do not commit if checks fail.

## Commit workflow

1. Stage intended files.
2. Re-check staged changes.
3. Commit with a clear message.
4. Confirm commit result.

```bash
git add <files>
git diff --cached --stat
git commit -m "TEAM-123: Imperative summary"
git log --oneline -1
```

## Alignment with other commands

- `/commit`: produces clean, scoped commits.
- `/create-pr`: assumes commits are already clean and branch is synchronized before opening the pull request.
- `/address-pr`: uses the same commit quality bar for review feedback and learnings updates.

## Safety boundaries

- Do not include unrelated files in the commit.
- Do not bypass hooks with `--no-verify`.
- Do not rewrite history unless explicitly requested.
- Do not push unless explicitly requested. If push is requested after history rewrite, use `git push --force-with-lease`.

## Exit criteria

- A new commit exists with a clear subject.
- Commit includes only intended files.
- Required local checks pass.

## Stop conditions

- No staged or unstaged changes to commit.
- Commit scope is ambiguous and the user has not clarified.
- Required checks fail and cannot be fixed in scope.

## Report out

Provide:

- Commit subject and hash
- Files committed
- Commands run
- Checks run (or skipped, with reason)
