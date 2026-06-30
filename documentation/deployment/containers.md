# Container Deployment

This document is the deployment source of truth for Tribunal's separate web,
engine, and proxy services. `documentation/ARCHITECTURE.md` describes the same
topology at the system level. Older notes in `documentation/WEFT_MIGRATION_PLAN.md`
that describe an in-process Weft engine are historical context unless they are
explicitly scoped to web-only producer behavior.

Tribunal deploys as three long-running application services plus managed
Postgres and Redis:

- `tribunal-web`: public SvelteKit server for UI, API routes, and GitHub webhooks.
- `tribunal-engine`: internal singleton review engine. This service owns
  `WEFT_DATABASE_URL` and must run exactly one Machine per durable Weft store.
- `tribunal-proxy`: public HTTPS credential-injecting egress broker for sandbox traffic.

The first Fly deployment is infrastructure-ready only: deploy
`tribunal-engine` with `REVIEWS_ENABLED=false`. Enable live review execution only
after the proxy CIDR, Tensorlake sandbox image, health checks, and fake load gate
all pass.

## Source Files

Container image definitions:

- `deployment/containers/web.Dockerfile`
- `deployment/containers/engine.Dockerfile`
- `deployment/containers/proxy.Dockerfile`
- `deployment/containers/reviewer.Dockerfile`

Fly app definitions:

- `deployment/fly/web.toml`
- `deployment/fly/engine.toml`
- `deployment/fly/proxy.toml`

The Fly configs intentionally contain only non-sensitive environment values.
Set secrets with `flyctl secrets set`; do not commit real credentials in TOML or
dotenv files.

## Service Contract

| Fly app           | Public | Port | Health path | Machine size       | Scaling rule                 |
| ----------------- | ------ | ---- | ----------- | ------------------ | ---------------------------- |
| `tribunal-web`    | yes    | 3000 | `/health`   | shared CPU, 1 GB   | at least one Machine running |
| `tribunal-engine` | no     | 3001 | `/health`   | shared CPU, 1 GB   | exactly one Machine          |
| `tribunal-proxy`  | yes    | 3002 | `/health`   | shared CPU, 512 MB | at least one Machine running |

Do not wire services through `localhost` in production. Fly app-to-app traffic
uses private DNS:

```sh
TRIBUNAL_ENGINE_URL=http://tribunal-engine.internal:3001
```

`tribunal-engine` intentionally has no Fly `http_service` entry. It accepts
direct private 6PN traffic only, and `deployment/fly/engine.toml` sets
`TRIBUNAL_ENGINE_BIND_HOST=::` so the Bun server listens on IPv6 for
`tribunal-engine.internal` traffic.

The proxy is intentionally public because Tensorlake sandboxes need a stable
public egress target. Allocate a dedicated public IPv4 for `tribunal-proxy` and
set `TRIBUNAL_PROXY_CIDR` to that address with a `/32` suffix.

## Environment Ownership

`WEFT_DATABASE_URL` belongs only on `tribunal-engine`. Never set it on
`tribunal-web`. The web service writes review intents to the application
database; the engine claims those intents and owns durable Weft execution state.

Use pooled Neon runtime URLs for long-running Fly services unless a specific
driver path requires direct Postgres. Use a direct, unpooled Neon URL for
migrations:

```sh
DATABASE_URL="<direct-neon-url>" bun run db:migrate
```

Required secret groups:

| App               | Required secrets                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tribunal-web`    | `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `PUBLIC_NEON_AUTH_URL`, `NEON_AUTH_BASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `TRIBUNAL_ENGINE_CONTROL_TOKEN` |
| `tribunal-engine` | `DATABASE_URL`, `WEFT_DATABASE_URL`, `ENCRYPTION_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `TENSORLAKE_API_KEY`, `TRIBUNAL_SANDBOX_IMAGE`, `TRIBUNAL_PROXY_URL`, `TRIBUNAL_PROXY_CIDR`, `PROXY_SIGNING_KEY`, `TRIBUNAL_ENGINE_CONTROL_TOKEN`, `ANTHROPIC_ADMIN_KEY`                 |
| `tribunal-proxy`  | `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `TRIBUNAL_PROXY_URL`, `TRIBUNAL_PROXY_CIDR`, `PROXY_CA_CERT`, `PROXY_SIGNING_KEY`                                                                                           |

`TRIBUNAL_ENGINE_CONTROL_TOKEN` must match between web and engine.
`PROXY_SIGNING_KEY` must match between engine and proxy.

For multiline secrets, read from files outside the repository or from an ignored
secrets directory:

```sh
flyctl secrets set -a tribunal-web GITHUB_APP_PRIVATE_KEY="$(cat /secure/path/github-app-private-key.pem)"
flyctl secrets set -a tribunal-engine GITHUB_APP_PRIVATE_KEY="$(cat /secure/path/github-app-private-key.pem)"
flyctl secrets set -a tribunal-proxy GITHUB_APP_PRIVATE_KEY="$(cat /secure/path/github-app-private-key.pem)"
flyctl secrets set -a tribunal-proxy PROXY_CA_CERT="$(cat /secure/path/proxy-ca.pem)"
```

## Preflight

Run these gates before creating or changing Fly apps:

```sh
bun run verify

docker build -f deployment/containers/web.Dockerfile -t tribunal-web:test .
docker build -f deployment/containers/engine.Dockerfile -t tribunal-engine:test .
docker build -f deployment/containers/proxy.Dockerfile -t tribunal-proxy:test .
docker build -f deployment/containers/reviewer.Dockerfile -t tribunal-reviewer:test .

flyctl auth whoami
flyctl platform regions
flyctl config validate --config deployment/fly/web.toml
flyctl config validate --config deployment/fly/engine.toml
flyctl config validate --config deployment/fly/proxy.toml
```

Completion signal: all commands exit zero, `dfw` is available, and no local
verification suite is skipped.

Failure signal: stop before app creation if `bun run verify`, any image build,
or any Fly config validation fails.

## Fly Setup

Create the apps without deploying first. Use `dfw` as the primary region unless
capacity checks fail before app creation.

```sh
flyctl apps create tribunal-web --org <organization>
flyctl apps create tribunal-engine --org <organization>
flyctl apps create tribunal-proxy --org <organization>
```

Allocate a dedicated public IPv4 only for the proxy:

```sh
flyctl ips allocate-v4 --dedicated -a tribunal-proxy
flyctl ips list -a tribunal-proxy
```

Copy the dedicated address and set the proxy CIDR:

```sh
flyctl secrets set -a tribunal-engine TRIBUNAL_PROXY_CIDR="<dedicated-proxy-ip>/32"
flyctl secrets set -a tribunal-proxy TRIBUNAL_PROXY_CIDR="<dedicated-proxy-ip>/32"
```

Verify the engine app has no public address:

```sh
flyctl ips list -a tribunal-engine
```

Completion signal: `tribunal-proxy` has a dedicated IPv4, `tribunal-engine` has
no public IPv4, and both engine and web use `http://tribunal-engine.internal:3001`
for engine traffic.

## External Services

Configure these before the first deploy:

1. Add the production web domain to Neon Auth trusted domains.
2. Set the GitHub OAuth callback URL to
   `https://<web-domain>/connect/github/account/callback`.
3. Set the GitHub App webhook URL to `https://<web-domain>/api/webhooks/github`.
4. Publish the reviewer image to Tensorlake only as an explicit release
   operation. Store the returned image identifier in `TRIBUNAL_SANDBOX_IMAGE` on
   `tribunal-engine`.
5. Set `TRIBUNAL_PROXY_URL` to `https://tribunal-proxy.fly.dev` or the chosen
   custom proxy domain on both engine and proxy.

Do not enable live review traffic during this step.

## Deploy Procedure

Apply database migrations with a direct Neon URL before deploying application
images:

```sh
DATABASE_URL="<direct-neon-url>" bun run db:migrate
```

Deploy in dependency order:

```sh
flyctl deploy . --config deployment/fly/proxy.toml --dockerfile deployment/containers/proxy.Dockerfile
flyctl deploy . --config deployment/fly/engine.toml --dockerfile deployment/containers/engine.Dockerfile
flyctl deploy . --config deployment/fly/web.toml --dockerfile deployment/containers/web.Dockerfile
```

Force the engine to exactly one Machine after the first engine deploy and after
any later scaling change:

```sh
flyctl scale count 1 -a tribunal-engine
flyctl machines list -a tribunal-engine
```

Completion signal: exactly one `tribunal-engine` Machine exists, it is in `dfw`,
and `flyctl machines list -a tribunal-engine` shows no extra started or stopped
engine Machines.

Failure signal: if a second engine Machine exists against the same
`WEFT_DATABASE_URL`, stop the deployment and remove the duplicate before running
health gates.

## Automatic Main Deploy

`.github/workflows/deploy-production.yml` runs the deploy procedure after the
`CI` workflow succeeds on `main`. It can also be started manually with
`workflow_dispatch`. The workflow uses GitHub Actions environment `production`
for deploy credentials and audit history.

Required `production` environment secrets:

- `FLY_API_TOKEN`
- `MIGRATION_DATABASE_URL`: direct, unpooled Neon URL for migrations.
- `TENSORLAKE_API_KEY`

Required `production` environment variables:

- `FLY_ORG`: Fly organization that owns `tribunal-web`, `tribunal-engine`, and
  `tribunal-proxy`.
- `PRODUCTION_WEB_ORIGIN`: production web origin used for `/health`.
- `PRODUCTION_PROXY_ORIGIN`: production proxy origin used for proxy health and
  unauthorized-request checks. If unset, the workflow defaults to
  `https://tribunal-proxy.fly.dev`.

The workflow performs these steps:

1. Check out the exact `main` commit that passed CI.
2. Set up Bun and `flyctl`.
3. Validate Fly authentication, Fly configs, and live Fly state with
   `bun run deploy:status -- --live-status-only --allow-missing-sandbox-image`
   before publishing the reviewer image.
4. Build and run the reviewer image, publish it to Tensorlake, and stage the
   returned `TRIBUNAL_SANDBOX_IMAGE` on `tribunal-engine`.
5. Run `bun run db:migrate` with `MIGRATION_DATABASE_URL`.
6. Deploy proxy, engine, and web in dependency order.
7. Run `flyctl scale count 1 --app tribunal-engine`.
8. Run every health gate below plus explicit checks that the engine has exactly
   one non-destroyed Machine and no public ingress IP.

The pre-deploy live-state check permits `TRIBUNAL_SANDBOX_IMAGE` to be missing
because the workflow refreshes that secret in the same run. The post-deploy
live-state check uses `bun run deploy:status -- --live-status-only` without that
allowance, so the refreshed engine secret is required before the workflow can
finish.

The workflow does not create apps, allocate the proxy IPv4, configure provider
consoles, set long-lived runtime application secrets, enable live reviews, or
perform automatic rollback. Failed post-deploy health gates fail the workflow
loudly; use the rollback runbook when a migration-safe rollback is appropriate.

## Health Gates

Proxy public health:

```sh
curl -fsS https://tribunal-proxy.fly.dev/health
```

Engine private health from inside Fly private networking:

```sh
flyctl ssh console -a tribunal-web -C 'bun -e "const response = await fetch(\"http://tribunal-engine.internal:3001/health\"); console.log(await response.text()); process.exit(response.ok ? 0 : 1)"'
```

The engine response must include `singleton_lock: true`.

Web public health:

```sh
curl -fsS https://<web-domain>/health
```

Unauthorized proxy request:

```sh
status="$(curl -sS -o /tmp/tribunal-proxy-unauthorized.json -w '%{http_code}' https://tribunal-proxy.fly.dev/github/api.github.com/repos/lostgradient/tribunal/pulls/1)"
test "$status" = "401" -o "$status" = "403"
```

Fake-only review-engine load gate:

```sh
bun run --cwd applications/web test:unit:server -- --run test/load/review-engine-load-harness.test.ts
```

Completion signal: all health commands exit zero, the unauthorized proxy request
returns `401` or `403`, the fake-only load harness passes, and
`REVIEWS_ENABLED` is still `false`.

Failure signal: do not change `REVIEWS_ENABLED` to `true` if any health gate
fails or if the engine health response does not show `singleton_lock: true`.

## Enabling Live Reviews

Live review execution remains disabled until all of these are true:

- `tribunal-proxy` has a dedicated public IPv4 and `TRIBUNAL_PROXY_CIDR` is the
  matching `/32` on engine and proxy.
- `TRIBUNAL_SANDBOX_IMAGE` points at a reviewer image published to Tensorlake as
  an explicit release operation.
- Proxy, engine, and web health gates pass.
- Unauthorized proxy requests return `401` or `403`.
- The fake-only load harness passes.
- `flyctl machines list -a tribunal-engine` shows exactly one engine Machine.

Only then change `REVIEWS_ENABLED` to `true` for `tribunal-engine` and redeploy
the engine:

```sh
flyctl deploy . --config deployment/fly/engine.toml --dockerfile deployment/containers/engine.Dockerfile
```

Re-run every health gate after enabling live reviews.

## Rollback

Rollback in reverse dependency order when a deploy breaks health:

```sh
flyctl releases list -a tribunal-web
flyctl releases rollback <version> -a tribunal-web

flyctl releases list -a tribunal-engine
flyctl releases rollback <version> -a tribunal-engine
flyctl scale count 1 -a tribunal-engine

flyctl releases list -a tribunal-proxy
flyctl releases rollback <version> -a tribunal-proxy
```

After any rollback, re-run the health gates and verify the engine still has
exactly one Machine.

## Local Verification

Targeted commands:

```sh
bun run --cwd applications/web test:unit:server -- --run test/load/review-engine-load-harness.test.ts src/routes/health/server.spec.ts
bun run --cwd applications/engine test -- src/health.test.ts src/index.test.ts
bun run --cwd applications/proxy test -- src/health.test.ts src/proxy.test.ts src/runner-proxy.integration.test.ts
```

Full release gate:

```sh
bun run verify
```
