# Workflows

Tribunal is a deliberately small SvelteKit app. Its only integration is GitHub, and
its data model is flat: `user → github_installation → installation_repository →
repository → pull_request`. There is no background worker, durable workflow engine, or
other integration. "Workflow" here just means an end-to-end sequence of steps the code
actually runs today.

## User flow

This is the entire surviving product experience:

1. **Log in with GitHub.** The OAuth identity flow lives under
   `applications/web/src/routes/login/github/` (with `callback/`). This establishes who
   you are.
2. **Install the GitHub App.** The install/authorization flow lives under
   `applications/web/src/routes/connect/github/` (with `callback/`). Installing the app
   in an organization grants Tribunal repository access and registers webhooks.
3. **Browse your repositories.** Authenticated routes under
   `applications/web/src/routes/(authenticated)/repositories/` list the repositories the
   install grants access to.
4. **Browse open pull requests.** Drill into a repository
   (`repositories/[repositoryId]/pull-requests/`) to see its open pull requests, and into
   `.../pull-requests/[number]` for a single one.

That is the product: identity via OAuth, access via the App install, and a read view of
repositories and their pull requests.

## GitHub webhook processing

When the GitHub App is installed, GitHub delivers webhooks to
`applications/web/src/routes/api/webhooks/github/+server.ts`. The full processing
skeleton is intact, but it is the terminus of the pipeline — there is no workflow engine
behind it, so handlers persist or log rather than dispatching durable workflows.

A delivery is processed in order:

1. **Validate the request and verify the signature** (`verifySignature`) before doing any
   work. This is the security gate; an invalid signature is rejected immediately.
2. **Claim the delivery** (`claimWebhookDelivery`) so duplicate deliveries from GitHub
   retries are processed at most once. Pull-request "orchestrator trigger" events defer
   their claim until after successful processing so GitHub can retry on a transient 500.
3. **Store the event** (`storeWebhookEvent`) when it carries a repository, recording the
   event type, action, delivery id, sender, and payload.
4. **Route to a typed handler.** `createGithubWebhookRouter` validates the payload against
   the `github-webhook-schemas` Zod schemas and dispatches to the matching handler in
   `applications/web/src/routes/api/webhooks/github/handlers/` (pull request, review,
   review comment, check run/suite, installation lifecycle, push, issue comment, review
   thread, and so on).
5. **Invalidate caches and track PR state.** Repository rename/transfer events update
   stored metadata, access and resource caches are invalidated for affected repositories,
   and pull-request state tracking runs fire-and-forget.

What handlers no longer do is dispatch work to a durable runtime. The pull-request
"signal" functions in `@tribunal/github` (`signalPullRequestEvent`,
`signalPullRequestClosed`) keep their signatures so callers compile, but their bodies log
the signal that would have been sent and report success. The webhook entry point likewise
logs `would dispatch pull-request-review workflow` at the point where a workflow used to
be kicked off. If you are wiring up real downstream processing later, these log sites are
the seams.

## Database migration workflow

Schema changes follow a generate-review-validate-apply loop. The short version:

1. Edit the TypeScript schema in `packages/database/src/schema/`.
2. Generate SQL with `bun run db:generate -- --name describe-change`.
3. Review the SQL and commit the schema change and migration together.
4. CI validates the migration against a disposable Postgres service on pull request (the `migration` job in `.github/workflows/ci.yml`).
5. Merging to `main` applies the migration in production.

The canonical reference is [database/migration-workflow.md](database/migration-workflow.md),
with authoring patterns in [`packages/database/MIGRATIONS.md`](../packages/database/MIGRATIONS.md).

## Testing workflow

Run everything from the repository root through Turborepo:

```bash
bun run test     # all package and app tests
bun run check    # type checking and svelte-check
bun run lint     # oxlint + eslint
```

The web app splits its suites (`test:unit:server`, `test:unit:client`, `test:e2e`,
`test:accessibility`). See [TESTING.md](TESTING.md) for the environment decision tree,
fixtures, and where each kind of test lives.
