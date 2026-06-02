---
name: sync-branch
description: Rebase the current git branch on origin/main, integrate any upstream branch commits, and push updated history safely. Use when you need to sync a feature branch with main and its remote tracking branch before continuing work or opening a PR.
disable-model-invocation: true
allowed-tools: Read, Bash(git*:*)
agent: git-ninja
---

# Sync Branch

## When to use

- Sync a working branch with origin/main and its remote tracking branch.
- Resolve rebase conflicts and push updated history safely.

## Preflight

1. `git status` and `git branch --show-current`.
2. If the working tree is not clean, stop and ask whether to stash or commit. Do not rebase with uncommitted changes.
3. `git fetch origin`.

## Rebase on origin/main

1. `git rebase origin/main`.
2. If conflicts:
   - Use `git status` to locate conflicts.
   - Resolve files, `git add <files>`, then `git rebase --continue`.
   - If blocked, `git rebase --abort` and report.

## Check remote tracking branch

1. Determine upstream: `git rev-parse --abbrev-ref --symbolic-full-name @{u}`.
   - If no upstream exists, note it and skip remote checks.
2. If upstream exists, check ahead/behind:
   - `git rev-list --left-right --count HEAD...@{u}` (left = local, right = remote).
3. If the remote is ahead (right > 0), sync:
   - `git pull --rebase`.
   - Resolve conflicts if any (same conflict steps as above).

## Push

1. If an upstream exists, push with `git push --force-with-lease` after rebasing.
2. If no upstream exists, push and set it: `git push -u origin <branch>` (add `--force-with-lease` if rebase rewrote history).
3. Report final status (`git status` and updated ahead/behind counts).

## Exit criteria

- Local branch is rebased on `origin/main`.
- Remote tracking branch is up to date with the local branch.
- Push completed without non-fast-forward errors.
