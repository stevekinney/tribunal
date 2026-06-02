---
name: address-pr
description: Address unresolved GitHub pull request review comments by analyzing feedback, implementing fixes, and resolving threads.
context: fork
agent: git-ninja
allowed-tools: Read, Grep, Glob, Edit, Write, TaskCreate, TaskUpdate, TaskList, TaskGet, AskUserQuestion, mcp__linear__create_issue, Bash(bun*run scripts/get-pr-comments.ts:*), Bash(bun*run scripts/skill-context/list-review-learnings.ts:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*), Bash(git rebase:*), Bash(git merge:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git log:*), Bash(git diff:*), Bash(gh api:*), Bash(gh pr:*), Bash(bun run check:*), Bash(bun run test:*), Bash(bun run build:*), Bash(bun run lint:*), Bash(bun run format:*)
---

Your job is to address all unresolved PR review comments for the current branch. For each comment, you must:

1. **Understand the feedback** - Read the comment and the diff context carefully
2. **Make the change** - Implement what the reviewer requested
3. **Resolve the thread** - Mark the comment as resolved using `gh api`

## Unresolved Review Comments

!`bun --cwd "$(git rev-parse --show-toplevel)" run scripts/get-pr-comments.ts`

Use this embedded output as the source of truth for triage. Have the @"task-master (agent)" make a task list to track your work.

## Preflight

1. Capture current repository state.
2. Identify the PR number (use `PR_NUMBER` if supplied).
3. Sync the current branch with the latest `origin/main` using the best strategy for the current state (for example: rebase, fast-forward merge, or merge).
4. Fetch unresolved review comments.

!`git status`
!`git branch --show-current`
!`git fetch origin`

You must complete step 3 before triaging or addressing review comments. Do not skip sync.

Select the strategy that preserves branch integrity with the least risk, resolve conflicts, and ensure your branch includes the latest `origin/main` changes before proceeding.

**Web (claude.ai):** The script above may not be available. Use `gh api` directly:

```bash
# Get unresolved review threads via GraphQL (paginated)
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            isOutdated
            comments(first: 100) {
              nodes {
                id
                body
                path
                line
                url
                createdAt
                diffHunk
                author {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
' -f owner=OWNER -f repo=REPO -F pr=PR_NUMBER
```

Replace `OWNER`, `REPO`, and `PR_NUMBER` with actual values. If `pageInfo.hasNextPage` is true, re-run with `-f after=ENDCURSOR`. `first: 100` silently drops overflow.

## Request Copilot Review

Request Copilot as a reviewer if it is not already assigned:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/requested_reviewers \
  --method POST \
  --field 'reviewers[]=copilot'
```

This ensures we get AI-assisted code review feedback alongside human reviewers.

## CI Status is Non-Negotiable

**If CI is failing, you MUST fix it before doing anything else.** A PR with failing CI cannot be merged, so addressing review comments while CI is broken is wasted effort.

When CI fails:

1. Run the failing checks locally (`bun run check`, `bun run test`, `bun run build`)
2. Read the error output carefully and fix each issue
3. Commit your fixes locally
4. Move on to review comments immediately — do NOT poll or wait for remote CI to pass. Local checks passing is sufficient to proceed.
5. Push later, only after the required learnings update has been committed.

Do not skip this. Do not defer this. Fix CI first.

When automation decisions depend on CI state, treat `pending` as non-terminal. Poll with a bounded timeout instead of failing immediately on the first pending response.

## Triage before implementation

After syncing with `origin/main` and fetching all unresolved comments, and **before implementing anything**, bucket every comment into one of two categories:

1. **Already addressed** — the code already reflects what the reviewer asked for (e.g., a subsequent commit fixed it, or a rebase resolved the diff). Resolve the thread immediately via `gh api graphql`.
2. **Needs work** — the comment requires a code change. Create a task via `TaskCreate` with:
   - `subject`: imperative summary of the fix (e.g., "Extract helper for date formatting")
   - `description`: the reviewer's comment text, file path, line number, and the thread ID (`PRRT_...`) for later resolution
   - `activeForm`: present-continuous form (e.g., "Extracting date formatting helper")

After triaging all comments, use `TaskList` to review the full work queue. Process tasks in order, marking each `in_progress` before starting and `completed` when done.

This prevents wasted effort on already-resolved threads and gives you a clear picture of remaining work before you start editing files.

## Handling different comment types

- **[HAS SUGGESTION]**: The reviewer provided a code suggestion. Apply it exactly or adapt it as needed.
- **[OUTDATED]**: The code has changed since the comment was made. Verify whether the issue still applies before making changes.
- If feedback identifies duplicate helpers or warning text drift, consolidate to a shared helper and update all call sites in the same change.
- If feedback flags session lifecycle or telemetry ordering, verify `session-end` cannot emit before/without `session-start` and avoid synthetic session IDs.

When feedback points out a dropped warning or lifecycle log line, restore output parity unless there is an explicit replacement signal with equivalent operator value.

## Out-of-scope feedback

**Default: do the work.** Even if feedback feels tangential or out-of-scope, implement what the reviewer asked. Never commit a message like "this deserves its own ticket" or "will address in a follow-up" — that is punting, not addressing.

**Only exception:** you are genuinely unsure whether doing the work is safe — for example, the change involves a large refactor with regression risk, or it contradicts other reviewer feedback. In this case, ask the user with two explicit options:

1. **Do the work now** — implement it in this PR
2. **Create a Linear ticket** — use `mcp__linear__create_issue` to create a ticket blocked by the current ticket, so it is tracked and not forgotten

Never silently punt. Either do the work or get explicit user approval to defer it.

## Resolving threads

After addressing a comment, resolve it using the Thread ID. You can resolve multiple threads in a single call:

```sh
gh api graphql -f query='
  mutation {
    t1: resolveReviewThread(input: {threadId: "PRRT_..."}) { thread { isResolved } }
  }'
```

## Safety boundaries

- Do not change dependencies or config files unless a review comment explicitly requires it.
- Do not reformat unrelated files or expand scope.
- Do not push or resolve review threads until local checks pass and the required learnings update is committed.

## Commit quality (aligned)

Use the same standards as `/commit` and `/create-pr`:

- Stage only files required for review fixes and learnings updates.
- Keep commit messages explicit; include ticket identifier when available.
- Run `bun run check` before committing.
- Push only after the commit includes the required learnings update.

## Learning (required)

Generate a learning entry for every run and commit it before pushing.

Create a new file in `documentation/learnings/` on every run:

- File name format: `YYYY-MM-DD-${kebabCasedName}` (optional `.md` suffix).
- Keep names specific so each run gets an independent file; if the name already exists, append a numeric suffix (`-2`, `-3`, ...).
- If durable learnings emerged, write concise bullets with only durable patterns.
- If no durable learnings emerged, write `- No durable learnings from this run.`

Prefer:

- A short update to an existing rule when the guidance is truly invariant.
- A skill reference file for longer-form context or examples.

Never skip this update. The new reference file must be included in a commit before any push.

## Workflow

1. Complete preflight.
2. Read the PR description to understand the overall context.
3. Check existing learning entries (run `bun --cwd "$(git rev-parse --show-toplevel)" run scripts/skill-context/list-review-learnings.ts`) for known false-positive patterns. Skip or deprioritize bot-generated threads that match a documented false positive.
4. **Triage all comments** — resolve already-addressed threads immediately; create tasks for comments that need work (see "Triage before implementation" above).
5. Work through the task list. For each task: mark `in_progress` → implement the fix → run `bun run check` → mark `completed`.
6. Generate and record learnings in a new `documentation/learnings/YYYY-MM-DD-${kebabCasedName}` file (required for every run).
7. Commit all changes (code fixes + rule updates + learnings update) with a clear message referencing the feedback, following `/commit` standards.
8. Push to remote only after the commit that includes learnings.
9. Resolve the threads after push.
10. **Re-check for new comments** (see below).

## Re-check for new comments

After resolving all threads and pushing, re-fetch unresolved review comments to catch any
that arrived while you were working:

```bash
bun --cwd "$(git rev-parse --show-toplevel)" run scripts/get-pr-comments.ts
```

- If **new unresolved comments exist**, repeat steps 3–10 for the new batch.
- If **no unresolved comments remain**, proceed to Report Out.
- **Cap at 3 iterations** to avoid unbounded loops. If comments keep arriving after
  3 passes, report the remaining unresolved threads in the summary and let the user
  decide whether to run `/pr-address` again.

## Exit criteria

- All unresolved review comments are addressed.
- All addressed review threads are resolved.
- Re-check confirms no new unresolved comments (or iteration cap reached).
- Local checks pass (`bun run check`).
- A new `documentation/learnings/YYYY-MM-DD-${kebabCasedName}` file is added, committed, and pushed before thread resolution.
- Changes pushed to remote.
- If the pipeline hit a stop condition, a `documentation/pipeline-reflections/` file was written and committed.

## Stop conditions

- PR number is missing and cannot be inferred.
- Access or auth issues prevent fetching comments or resolving threads.
- Required doc locations are missing or not writable.

When any stop condition is hit, write a failure reflection before stopping:

1. Write a reflection file to `documentation/pipeline-reflections/YYYY-MM-DD-address-pr-<ticket-or-pr>.md`.
   - Use the ticket ID or PR number (e.g., `ticket-123` or `pr-456`) for the filename.
   - If the filename already exists, append to that file.
2. Follow the template in `documentation/pipeline-reflections/TEMPLATE.md`. Include the raw error output, which step in the workflow failed, and the PR context available at the time of failure.
3. Commit the reflection file alongside any other pending changes before stopping. If committing is not possible (auth failure, no write access), write the file to disk anyway.

## Report out

Provide:

- Summary of changes
- Commands run
- Files touched
- Tests run or not run (with reason)
- Learnings update details (including the exact reference filename added)
- Follow-ups needed
