---
name: tribunal-production-operations
description: Ship Tribunal to production and triage deployment, health-check, Fly, Neon, GitHub OAuth/App, Tensorlake, proxy, review-engine, or live-review rollout issues. Use when a user asks to deploy Tribunal, prepare production secrets, verify production readiness, enable live reviews, debug broken deploys, inspect production health, or recover/rollback Tribunal services.
---

# Tribunal Production Operations

## Overview

Operate Tribunal production from the repository runbooks. Treat `DEPLOYMENT.md`
as the setup checklist and `documentation/deployment/containers.md` as the
command-level source of truth for deploy, health, rollback, and live-review
enablement.

## Start Here

1. Read `DEPLOYMENT.md` and `documentation/deployment/containers.md` before
   changing production state.
2. Check local state without printing secrets:
   `git status --short --branch`, `bun run deploy:status`, `flyctl auth whoami`,
   `flyctl status --app tribunal-web`, `flyctl status --app tribunal-engine`,
   and `flyctl status --app tribunal-proxy`.
3. Classify the task:
   - **First deploy/readiness**: validate configuration, create apps, set
     secrets, migrate, deploy, and run safe-mode gates.
   - **Triage**: identify the failing layer before changing anything.
   - **Enable live reviews**: proceed only after every safe-mode gate passes.
   - **Rollback**: use the runbook and verify the full health gate afterward.

## Production Invariants

- Tribunal has three Fly apps: `tribunal-web`, `tribunal-engine`, and
  `tribunal-proxy`.
- `tribunal-engine` is private, has no public IP, and must run exactly one
  Machine.
- `WEFT_DATABASE_URL` belongs only on `tribunal-engine`; never set it on web.
- `TRIBUNAL_ENGINE_CONTROL_TOKEN` must match web and engine.
- `PROXY_SIGNING_KEY` must match engine and proxy.
- `TRIBUNAL_PROXY_CIDR` must be the dedicated proxy IPv4 with `/32`.
- `TRIBUNAL_SANDBOX_IMAGE` must be an explicit Tensorlake release identifier.
- `ANTHROPIC_ADMIN_KEY` is an Anthropic Admin API key, not a normal model API
  key. It should have the `sk-ant-admin...` prefix and is required by engine
  cost reporting.
- Keep `REVIEWS_ENABLED=false` until every safe-mode health gate passes.

## Gotchas

- Neon Auth sign-in and Tribunal repository authorization are separate GitHub
  OAuth flows with different client IDs:
  - Neon Auth uses its own GitHub OAuth App (client ID prefix `Ov23Li`). Its
    callback should point to `{NEON_AUTH_BASE_URL}/callback/github`. Do not
    change this to a Tribunal URL.
  - Tribunal repository authorization uses the `GITHUB_CLIENT_ID` from the
    `Tribunal Review` GitHub App (client ID prefix `Iv23li`). This is _not_ a
    standalone OAuth App—it is the GitHub App's built-in OAuth. Configure that
    GitHub App's callback URL as
    `https://<web-domain>/connect/github/account/callback`.
  - The GitHub App setup URL should be
    `https://<web-domain>/connect/github/callback`.
  - If the Connect GitHub flow says the redirect URI is not associated with
    this application, the GitHub App callback URL still points to localhost.
    Update it in GitHub Developer Settings → GitHub Apps → Tribunal Review →
    General → Callback URL.
- Neon Auth trusted domains are branch-scoped. If sign-in fails with
  `neon_auth_failed` after GitHub succeeds, verify
  `https://<web-domain>` is in
  `POST /projects/{project_id}/branches/{branch_id}/auth/domains` with
  `auth_provider: "better_auth"`. Neon Auth settings (trusted domains, OAuth
  providers, email/password toggles, Allow Localhost) are managed in the Neon
  Console under the project → branch → Auth → Configuration tab.
- `Allow Localhost` may stay enabled when local development intentionally uses
  the production Neon Auth branch. It is not a substitute for the production
  trusted domain.
- The app UI only exposes GitHub sign-in. Remove extra Neon Auth OAuth
  providers for production; email/password being enabled is unused surface
  unless a future UI exposes it.
- GitHub App `Tribunal Review` needs repository `Checks: Read and write` before
  live reviews. The engine creates and updates check runs through
  `packages/github/src/reviews/check-runs.ts`. `Commit statuses` may also be
  needed if the engine writes commit statuses separately from check runs.
- The GitHub App's webhook, callback URL, and setup URL all default to
  localhost after initial creation. All three must be updated to production
  URLs before first deploy. The webhook must also be marked Active with a
  secret set and SSL verification enabled—these are off by default.
- A repositories-page banner saying "Could not reach GitHub to list your
  installations" with Fly logs showing `401 Bad credentials` means the stored
  `oauth_connection` token is stale or invalid. With explicit user approval,
  mark that row `invalid` so the UI forces `/connect/github/account` again.
- Current Tensorlake limits may require publishing the reviewer image with
  `--cpus 1 --memory 1024`. Publish from a narrow temporary build context, not
  the whole repository, to avoid slow or stuck uploads.

## First Deploy Workflow

Use installed CLIs where possible before asking the user to do manual console
work. Do not print secret values.

1. Verify tooling and authentication: `flyctl`, `neonctl`, `gh`, Docker, Bun,
   and Tensorlake through `bunx tensorlake` if no global CLI exists.
2. Validate local release readiness:
   ```sh
   bun run verify
   docker build -f deployment/containers/web.Dockerfile -t tribunal-web:test .
   docker build -f deployment/containers/engine.Dockerfile -t tribunal-engine:test .
   docker build -f deployment/containers/proxy.Dockerfile -t tribunal-proxy:test .
   docker build -f deployment/containers/reviewer.Dockerfile -t tribunal-reviewer:test .
   ```
3. Create or verify Fly apps and proxy IPv4. Confirm `tribunal-engine` has no
   public IP.
4. Prepare Neon:
   - Use pooled runtime URLs for Fly services.
   - Use a direct, unpooled URL for migrations.
   - Use a separate `WEFT_DATABASE_URL` database or connection for engine-owned
     durable review state.
   - Add the production web domain to the Neon Auth branch trusted-domain list.
5. Publish the reviewer image to Tensorlake and record the returned image
   identifier as `TRIBUNAL_SANDBOX_IMAGE`.
6. Set Fly secrets by app according to the tables in the deployment docs.
7. Run migrations with the direct Neon URL:
   `DATABASE_URL="$MIGRATION_DATABASE_URL" bun run db:migrate`.
8. Deploy in dependency order: proxy, engine, web.
9. After deploying engine, run `flyctl scale count 1 --app tribunal-engine` and
   verify exactly one Machine.

If current `flyctl` resolves `build.dockerfile` relative to the Fly config file
and produces a path like `deployment/fly/deployment/containers/...`, create an
ignored temporary config under `.tmp/fly/` with corrected relative Dockerfile
paths. Do not edit production TOML just to work around local CLI path behavior.

## Safe-Mode Health Gates

Run these before enabling live reviews and after any deploy or rollback:

```sh
bun run deploy:status
curl -fsS https://tribunal-proxy.fly.dev/health
curl -fsS https://<web-domain>/health
flyctl ssh console -a tribunal-web -C 'bun -e "const response = await fetch(\"http://tribunal-engine.internal:3001/health\"); console.log(await response.text()); process.exit(response.ok ? 0 : 1)"'
status="$(curl -sS -o /tmp/tribunal-proxy-unauthorized.json -w '%{http_code}' https://tribunal-proxy.fly.dev/github/api.github.com/repos/lostgradient/tribunal/pulls/1)"
test "$status" = "401" || test "$status" = "403"
bun run --cwd applications/web test:unit:server -- --run test/load/review-engine-load-harness.test.ts
flyctl machines list --app tribunal-engine
flyctl ips list --app tribunal-engine
```

The engine health response must include `singleton_lock: true`. Also verify the
deployed engine still has `REVIEWS_ENABLED=false` during safe-mode validation.

## Triage Workflow

Start with evidence, not changes:

1. Run `bun run deploy:status` and capture which app, secret, IP, or Machine
   invariant is failing.
2. Check app status and logs:
   ```sh
   flyctl status --app tribunal-web
   flyctl status --app tribunal-engine
   flyctl status --app tribunal-proxy
   flyctl logs --app <app-name>
   ```
3. Map the symptom to a layer:
   - **Web health fails**: check `DATABASE_URL`, `REDIS_URL`, Neon Auth URLs,
     GitHub OAuth callback, and web logs.
   - **Engine health fails**: check `WEFT_DATABASE_URL`, exactly one Machine,
     private DNS, `ANTHROPIC_ADMIN_KEY`, Tensorlake image, and advisory lock.
   - **Proxy health fails**: check `DATABASE_URL`, `REDIS_URL`,
     `ANTHROPIC_API_KEY`, `PROXY_CA_CERT`, `PROXY_SIGNING_KEY`, and proxy logs.
   - **Unauthorized proxy returns 2xx**: treat as a security blocker; do not
     enable live reviews.
   - **GitHub login/webhooks fail**: verify GitHub OAuth callback, GitHub App
     callback/setup URL, webhook URL, webhook active state, webhook secret,
     Checks permission, and Neon Auth trusted domain.
   - **Repositories page says GitHub is unreachable**: inspect web logs for the
     GitHub status. If GitHub returns `401 Bad credentials` for
     `/user/installations`, treat it as a stale user OAuth connection and force
     reconnect by invalidating the row only after user approval.
   - **Tensorlake failures**: verify the published reviewer image identifier,
     proxy URL/CIDR, and sandbox resource limits.
4. Fix the smallest failing layer and re-run all safe-mode gates.

Stop and report a blocker instead of guessing when the missing information is a
secret, provider console setting, destructive database action, or production
switch that the user has not explicitly authorized.

## Enabling Live Reviews

Only enable live reviews after all safe-mode gates pass and the user explicitly
authorizes the production switch.

1. Change `REVIEWS_ENABLED=true` for `tribunal-engine` through the documented
   deployment path.
2. Redeploy only the engine unless another service changed.
3. Re-run every safe-mode health gate.
4. Watch engine/proxy logs for Anthropic, Tensorlake, proxy signing, or cost-cap
   failures.

Do not call the rollout complete until CI/local gates, Fly status, health
checks, unauthorized proxy behavior, and the singleton engine invariant are all
verified after the live-review switch.

## External Console Checklist

When CLI/API access cannot update provider settings, give the user a concise
checklist and ask only for statuses, not secrets:

- Neon Auth trusted domains includes the production web domain.
- Neon Auth GitHub provider callback is `{NEON_AUTH_BASE_URL}/callback/github`.
- GitHub App callback URL is
  `https://<web-domain>/connect/github/account/callback`.
- GitHub App setup URL is `https://<web-domain>/connect/github/callback`.
- GitHub App webhook URL is `https://<web-domain>/api/webhooks/github`.
- GitHub App webhook secret is set, without revealing its value.
- GitHub App webhook is active and SSL verification is enabled.
- GitHub App repository permissions include at minimum: Checks read/write,
  Code quality read/write, Contents read/write, Issues read/write,
  Merge queues read/write, Metadata read-only (mandatory), Projects
  read/write, Pull requests read/write, Webhooks read/write, and Workflows
  read/write.
- Neon Auth OAuth providers: GitHub only (remove Google if present).
- Neon Auth `Allow Localhost`: confirm it matches the intended policy (on for
  shared dev/prod Neon branch, off for isolated production).
- GitHub sign-in reaches Tribunal without an error page.
- Connect GitHub flow completes without a `redirect_uri` error and the
  repositories page shows the user's repositories.
