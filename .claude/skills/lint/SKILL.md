---
name: lint
description: Fix ESLint, TypeScript, and formatting issues in the codebase through iterative error resolution.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
argument-hint: [FOCUS=<area>]
disable-model-invocation: true
---

# Code Quality Fixing Task

## When to use

- Fix all code quality issues in the codebase through iterative error resolution.

## Inputs

- Arguments from the command invocation.
- Current repo state (git status/branch) when relevant.

## Preflight

1. Run `git status` and note any existing changes.
2. If `FOCUS` is supplied via `$ARGUMENTS`, prioritize those paths but do not ignore other failures.

## Required checks

Run each of the following commands and make sure they all pass.

- `bun run build`
- `bun run check`
- `bun run format` (writes fixes; use `bun run format:check` for validation)
- `bun run lint`
- `bun run test`

## Critical instructions

- Do not stop when you encounter errors. Finding errors is the point of this command.
- Fix the underlying problem. Do not suppress warnings.
- Work iteratively: fix one issue, re-run checks, repeat.

Your mission is to fix ALL errors, issues, and warnings you encounter. Claiming that an error is pre-existing is unacceptable.

## Safety boundaries

- Do not modify ESLint rules or TypeScript configuration.
- Do not use inline comments to bypass rules.
- Do not add or upgrade dependencies unless explicitly requested.
- Avoid broad refactors or formatting outside the error scope.

## Exit criteria

- All required checks pass with zero warnings.
- No config or dependency changes were made unless explicitly requested.

## Stop conditions

- Fixes require changing config, dependencies, or scope beyond the errors.
- Failures are non-actionable without new context or access.

## Report out

Provide:

- Summary of changes
- Commands run
- Files touched
- Tests run or not run (with reason)
- Follow-ups needed
