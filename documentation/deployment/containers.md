# Container Deployment

This document is the deployment source of truth for Tribunal's separate web,
engine, and proxy services. `documentation/ARCHITECTURE.md` describes the same
topology at the system level. Older notes in `documentation/WEFT_MIGRATION_PLAN.md`
that describe an in-process Weft engine are historical context unless they are
explicitly scoped to web-only producer behavior.

Tribunal deploys as three Fly application services plus managed Postgres and
Redis. Public web/proxy Machines stop when idle; the private engine wakes
through Flycast and exits after idle review work drains:

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

| Fly app           | Public | Port | Health path | Machine size       | Scaling rule                |
| ----------------- | ------ | ---- | ----------- | ------------------ | --------------------------- |
| `tribunal-web`    | yes    | 3000 | `/health`   | shared CPU, 1 GB   | one Machine, stop on idle   |
| `tribunal-engine` | no     | 3001 | `/health`   | shared CPU, 1 GB   | one Machine, self-exit idle |
| `tribunal-proxy`  | yes    | 3002 | `/health`   | shared CPU, 512 MB | one Machine, stop on idle   |

Do not wire services through `localhost` in production. Fly app-to-app traffic
that must wake stopped private Machines uses Flycast:

```sh
TRIBUNAL_ENGINE_URL=http://tribunal-engine.flycast
```

`.internal` is not sufficient for stopped private Machines because it bypasses
the Fly Proxy and cannot auto-start the engine. `tribunal-engine` has a private
Flycast service, no public IP, and `deployment/fly/engine.toml` sets
`TRIBUNAL_ENGINE_BIND_HOST=0.0.0.0` so the Bun server listens for Flycast
traffic. All engine routes that mutate state remain protected by
`TRIBUNAL_ENGINE_CONTROL_TOKEN`.

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

The production Neon compute must be able to suspend after idle work drains:

```sh
curl -fsS -X PATCH \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":{"suspend_timeout_seconds":300}}' \
  "https://console.neon.tech/api/v2/projects/flat-credit-58562329/endpoints/ep-round-dew-ap98dps9"
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

Allocate the private Flycast address for engine wake traffic:

```sh
flyctl ips allocate-v6 --private -a tribunal-engine
flyctl ips list -a tribunal-engine
```

Completion signal: `tribunal-proxy` has a dedicated IPv4, `tribunal-engine` has
one private IPv6 address and no public IPv4/IPv6, and web uses
`http://tribunal-engine.flycast` for engine traffic.

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
flyctl deploy . --config deployment/fly/proxy.toml
flyctl scale count 1 --yes -a tribunal-proxy

flyctl deploy . --config deployment/fly/engine.toml
flyctl scale count 1 --yes -a tribunal-engine

flyctl deploy . --config deployment/fly/web.toml
flyctl scale count 1 --yes -a tribunal-web
```

Completion signal: exactly one non-destroyed Machine exists for each Fly app,
web/proxy have `auto_stop_machines="stop"`, and engine has a private Flycast
service with no public IP.

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
- `NEON_API_KEY`
- `TENSORLAKE_API_KEY`

Required `production` environment variables:

- `FLY_ORG`: Fly organization that owns `tribunal-web`, `tribunal-engine`, and
  `tribunal-proxy`.
- `NEON_PROJECT_ID`: `flat-credit-58562329`.
- `NEON_PRODUCTION_ENDPOINT_ID`: `ep-round-dew-ap98dps9`.
- `PRODUCTION_WEB_ORIGIN`: production web origin used for `/health`.

Optional `production` environment variables:

- `PRODUCTION_PROXY_ORIGIN`: production proxy origin used for proxy health and
  unauthorized-request checks. If unset, the workflow defaults to
  `https://tribunal-proxy.fly.dev`.

The workflow performs these steps:

1. Check out the exact `main` commit that passed CI.
2. Set up Bun and `flyctl`.
3. Validate Fly authentication, Fly configs, and live Fly state with
   `bun run deploy:status -- --live-status-only --allow-missing-sandbox-image --allow-pending-engine-machine`
   before publishing the reviewer image.
4. Build and run the reviewer image, register the reviewer Dockerfile with
   Tensorlake, and stage the returned `TRIBUNAL_SANDBOX_IMAGE` on
   `tribunal-engine`.
5. Run `bun run db:migrate` with `MIGRATION_DATABASE_URL`.
6. Deploy proxy, engine, and web in dependency order, running
   `flyctl scale count 1 --yes --app <app>` after each deploy.
7. Verify the Neon production endpoint reports `suspend_timeout_seconds=300`.
8. Run every health gate below plus explicit checks that each app has exactly
   one non-destroyed Machine, web/proxy stop on idle, and the engine has private
   Flycast ingress only.

The pre-deploy live-state check permits `TRIBUNAL_SANDBOX_IMAGE` to be missing
because the workflow refreshes that secret in the same run, and permits zero
engine Machines so a first automatic deploy can create one. The post-deploy
live-state check uses `bun run deploy:status -- --live-status-only` without
those allowances, so the refreshed engine secret and singleton engine Machine
are required before the workflow can finish.

### When the reviewer image cannot be published

Publishing the reviewer image to Tensorlake is allowed to fail without stranding
production on stale code. A Tensorlake outage or an exhausted CPU quota would
otherwise skip the migration, proxy, engine, and web deploys entirely — a much
larger problem than a stale reviewer.

If the publish step fails, the workflow:

1. Requires that `tribunal-engine` already has a `TRIBUNAL_SANDBOX_IMAGE` secret.
   The engine validates that variable with `z.string().min(1)` at startup, so
   deploying with no image at all would crash-loop it. With no existing secret to
   fall back on — a first-ever deploy — the workflow stops here and deploys
   nothing.
2. Skips staging a new secret, leaving the previously published reviewer image in
   place.
3. Runs migrations and deploys proxy, engine, and web as usual, so application
   code reaches production.
4. Fails the run at the end. The deploy succeeded but is **degraded**: the apps
   are current, the reviewer image is not. Re-run the workflow once Tensorlake is
   healthy to bring the reviewer back in sync.

The run is deliberately marked failed rather than green — a green result would
hide the fact that reviews are running against an older image.

The workflow does not create apps, allocate the proxy IPv4, configure provider
consoles, set long-lived runtime application secrets, enable live reviews, or
perform automatic rollback. Failed post-deploy health gates fail the workflow
loudly; use the rollback runbook when a migration-safe rollback is appropriate.

## Health Gates

Proxy public health:

```sh
proxy_origin="${PRODUCTION_PROXY_ORIGIN:-https://tribunal-proxy.fly.dev}"
curl -fsS "${proxy_origin%/}/health"
```

Engine private health from inside Fly private networking:

```sh
flyctl ssh console -a tribunal-web -C 'bun -e "const response = await fetch(\"http://tribunal-engine.flycast/health\"); console.log(await response.text()); process.exit(response.ok ? 0 : 1)"'
```

The engine response must include `singleton_lock: true`.

Web public health:

```sh
curl -fsS https://<web-domain>/health
```

Unauthorized proxy request:

```sh
proxy_origin="${PRODUCTION_PROXY_ORIGIN:-https://tribunal-proxy.fly.dev}"
status="$(curl -sS -o /tmp/tribunal-proxy-unauthorized.json -w '%{http_code}' "${proxy_origin%/}/github/api.github.com/repos/lostgradient/tribunal/pulls/1")"
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
- `tribunal-engine` has a private Flycast IPv6 address and no public ingress IP.
- Proxy, engine, and web health gates pass.
- Unauthorized proxy requests return `401` or `403`.
- The fake-only load harness passes.
- `flyctl machines list` shows exactly one non-destroyed Machine for web,
  engine, and proxy.

Only then change `REVIEWS_ENABLED` to `true` for `tribunal-engine` and redeploy
the engine:

```sh
flyctl deploy . --config deployment/fly/engine.toml
```

Re-run every health gate after enabling live reviews.

## Rollback

Rollback in reverse dependency order when a deploy breaks health:

```sh
flyctl releases list -a tribunal-web
flyctl releases rollback <version> -a tribunal-web

flyctl releases list -a tribunal-engine
flyctl releases rollback <version> -a tribunal-engine
flyctl scale count 1 --yes -a tribunal-engine

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
