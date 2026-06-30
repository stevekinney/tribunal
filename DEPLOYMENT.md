# Deployment

This is the operator checklist for preparing Tribunal production credentials and
first deploy setup. The detailed container runbook lives in
`documentation/deployment/containers.md`; use that document for command-level
deploy, health check, rollback, and live-review enablement gates.

Tribunal deploys as three Fly apps:

- `tribunal-web`: public SvelteKit application, API routes, and GitHub webhooks.
- `tribunal-engine`: private singleton review engine, woken through Flycast.
- `tribunal-proxy`: public credential-injecting proxy for sandbox traffic.

The first production deploy should keep review execution disabled. The checked-in
Fly engine configuration sets `REVIEWS_ENABLED=false`; do not enable it until the
proxy, sandbox image, health checks, and fake load gate all pass.

## Accounts And Artifacts

Prepare these before creating Fly apps or setting secrets:

- A Fly organization that can create `tribunal-web`, `tribunal-engine`, and
  `tribunal-proxy`.
- A Neon Postgres project for the application database.
- Neon Auth configured with GitHub as the only sign-in provider.
- A Redis instance reachable from Fly for web and proxy runtime state.
- A GitHub OAuth application for user repository authorization.
- A GitHub App for repository installation access and webhooks.
- An Anthropic API key for model requests through the proxy.
- An Anthropic Admin API key for engine-side usage and accounting checks.
- A Tensorlake API key.
- A published Tensorlake reviewer image identifier for
  `deployment/containers/reviewer.Dockerfile`.
- A proxy certificate authority certificate if the proxy deployment expects
  `PROXY_CA_CERT`.

## Generated Secrets

Generate these once and store them in a password manager or secret store. Do not
commit them to `.env`, TOML, or documentation.

```sh
openssl rand -hex 32 # ENCRYPTION_KEY: 64 hex characters
openssl rand -hex 32 # TRIBUNAL_ENGINE_CONTROL_TOKEN
openssl rand -hex 32 # PROXY_SIGNING_KEY
```

Use the same `ENCRYPTION_KEY` value for `tribunal-web`, `tribunal-engine`, and
`tribunal-proxy` unless you are deliberately performing key rotation.

`TRIBUNAL_ENGINE_CONTROL_TOKEN` must match between `tribunal-web` and
`tribunal-engine`. `PROXY_SIGNING_KEY` must match between `tribunal-engine` and
`tribunal-proxy`.

Keep multiline secrets as files outside the repository, for example:

- GitHub App private key: `/secure/path/github-app-private-key.pem`
- Proxy certificate authority certificate: `/secure/path/proxy-ca.pem`

## Neon Setup

Create or choose the production application database.

- `DATABASE_URL`: pooled Neon runtime connection string for long-running Fly
  services.
- Direct migration URL: unpooled Neon connection string used only when running
  migrations.
- `WEFT_DATABASE_URL`: engine-owned durable review state database connection.
  This belongs only on `tribunal-engine`.
- Production endpoint scale-to-zero: set
  `suspend_timeout_seconds=300` for Neon project `flat-credit-58562329`,
  endpoint `ep-round-dew-ap98dps9`.

Run migrations with the direct, unpooled URL:

```sh
DATABASE_URL="<direct-neon-url>" bun run db:migrate
```

Configure Neon Auth:

- Add the production web domain to Neon Auth trusted domains.
- Set `PUBLIC_NEON_AUTH_URL` from the Neon Auth client URL.
- Set `NEON_AUTH_BASE_URL` from the Neon Auth issuer/base URL.

## GitHub Setup

Create a GitHub OAuth application for account connection:

- Callback URL:
  `https://<web-domain>/connect/github/account/callback`
- Required secrets:
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `GITHUB_REDIRECT_URI`

Create a GitHub App for repository access:

- Installation flow uses `https://github.com/apps/<GITHUB_APP_NAME>/installations/new`.
- Webhook URL: `https://<web-domain>/api/webhooks/github`
- Required secrets:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_NAME`
  - `GITHUB_APP_PRIVATE_KEY`
  - `GITHUB_APP_WEBHOOK_SECRET`

The OAuth application identifies the user. The GitHub App grants repository and
pull request access through installations.

## Proxy And Sandbox Setup

The proxy is public because Tensorlake sandboxes need a stable egress target.
Allocate a dedicated IPv4 for `tribunal-proxy`, then set the CIDR to that exact
address with `/32`.

```sh
flyctl ips allocate-v4 -a tribunal-proxy
flyctl ips list -a tribunal-proxy
```

Required proxy-related values:

- `TRIBUNAL_PROXY_URL`: `https://tribunal-proxy.fly.dev` or the chosen custom
  proxy domain.
- `TRIBUNAL_PROXY_CIDR`: `<dedicated-proxy-ip>/32`.
- `PROXY_SIGNING_KEY`: shared by engine and proxy.
- `PROXY_CA_CERT`: certificate authority certificate for proxy trust.
- `ANTHROPIC_API_KEY`: set on `tribunal-proxy`.
- `ANTHROPIC_ADMIN_KEY`: set on `tribunal-engine`.
- `TENSORLAKE_API_KEY`: set on `tribunal-engine`.
- `TRIBUNAL_SANDBOX_IMAGE`: explicit Tensorlake reviewer image identifier.

Publish the reviewer image as an explicit Tensorlake release operation and store
the returned image identifier in `TRIBUNAL_SANDBOX_IMAGE`. Do not point production
at an implicit or local image tag.

## Fly Apps

Create the apps before setting app secrets:

```sh
flyctl apps create tribunal-web --org <organization>
flyctl apps create tribunal-engine --org <organization>
flyctl apps create tribunal-proxy --org <organization>
```

Verify `tribunal-engine` has no public IP address:

```sh
flyctl ips list -a tribunal-engine
```

Allocate a private Flycast address for the engine:

```sh
flyctl ips allocate-v6 --private -a tribunal-engine
flyctl ips list -a tribunal-engine
```

Production engine wake traffic must use Flycast:

```sh
TRIBUNAL_ENGINE_URL=http://tribunal-engine.flycast
```

Do not use `.internal` for stopped private Machines; `.internal` bypasses the
Fly Proxy and cannot wake a stopped engine. Never use `localhost` for production
service links.

## Fly Secrets

Set secrets with `flyctl secrets set`. The Fly TOML files intentionally contain
only non-sensitive configuration.

### `tribunal-web`

```sh
flyctl secrets set -a tribunal-web \
  DATABASE_URL="<pooled-neon-runtime-url>" \
  REDIS_URL="<redis-url>" \
  ENCRYPTION_KEY="<64-hex-character-key>" \
  PUBLIC_NEON_AUTH_URL="<neon-auth-client-url>" \
  NEON_AUTH_BASE_URL="<neon-auth-base-url>" \
  GITHUB_CLIENT_ID="<github-oauth-client-id>" \
  GITHUB_CLIENT_SECRET="<github-oauth-client-secret>" \
  GITHUB_REDIRECT_URI="https://<web-domain>/connect/github/account/callback" \
  GITHUB_APP_ID="<github-app-id>" \
  GITHUB_APP_NAME="<github-app-name>" \
  GITHUB_APP_WEBHOOK_SECRET="<github-app-webhook-secret>" \
  TRIBUNAL_ENGINE_CONTROL_TOKEN="<shared-engine-control-token>"

flyctl secrets set -a tribunal-web \
  GITHUB_APP_PRIVATE_KEY="$(cat /secure/path/github-app-private-key.pem)"
```

### `tribunal-engine`

```sh
flyctl secrets set -a tribunal-engine \
  DATABASE_URL="<pooled-neon-runtime-url>" \
  WEFT_DATABASE_URL="<pooled-neon-weft-url>" \
  ENCRYPTION_KEY="<64-hex-character-key>" \
  GITHUB_APP_ID="<github-app-id>" \
  TENSORLAKE_API_KEY="<tensorlake-api-key>" \
  TRIBUNAL_SANDBOX_IMAGE="<tensorlake-reviewer-image-id>" \
  TRIBUNAL_PROXY_URL="https://tribunal-proxy.fly.dev" \
  TRIBUNAL_PROXY_CIDR="<dedicated-proxy-ip>/32" \
  PROXY_SIGNING_KEY="<shared-proxy-signing-key>" \
  TRIBUNAL_ENGINE_CONTROL_TOKEN="<shared-engine-control-token>" \
  ANTHROPIC_ADMIN_KEY="<anthropic-admin-key>"

flyctl secrets set -a tribunal-engine \
  GITHUB_APP_PRIVATE_KEY="$(cat /secure/path/github-app-private-key.pem)"
```

### `tribunal-proxy`

```sh
flyctl secrets set -a tribunal-proxy \
  DATABASE_URL="<pooled-neon-runtime-url>" \
  REDIS_URL="<redis-url>" \
  ENCRYPTION_KEY="<64-hex-character-key>" \
  GITHUB_APP_ID="<github-app-id>" \
  ANTHROPIC_API_KEY="<anthropic-api-key>" \
  TRIBUNAL_PROXY_URL="https://tribunal-proxy.fly.dev" \
  TRIBUNAL_PROXY_CIDR="<dedicated-proxy-ip>/32" \
  PROXY_SIGNING_KEY="<shared-proxy-signing-key>"

flyctl secrets set -a tribunal-proxy \
  GITHUB_APP_PRIVATE_KEY="$(cat /secure/path/github-app-private-key.pem)" \
  PROXY_CA_CERT="$(cat /secure/path/proxy-ca.pem)"
```

## GitHub Production Environment

After the Fly apps, provider settings, runtime secrets, and proxy IPv4 exist,
merges to `main` deploy through `.github/workflows/deploy-production.yml`. The
workflow starts only after the `CI` workflow succeeds on `main`; it can also be
started manually with `workflow_dispatch`.

Create a GitHub Actions environment named `production` with these inputs:

- Secrets:
  - `FLY_API_TOKEN`
  - `MIGRATION_DATABASE_URL`: direct, unpooled Neon URL for migrations.
  - `NEON_API_KEY`
  - `TENSORLAKE_API_KEY`
- Variables:
  - `FLY_ORG`: Fly organization that owns the three apps.
  - `NEON_PROJECT_ID`: `flat-credit-58562329`.
  - `NEON_PRODUCTION_ENDPOINT_ID`: `ep-round-dew-ap98dps9`.
  - `PRODUCTION_WEB_ORIGIN`: production web origin, for example
    `https://<web-domain>`.

Optional variables:

- `PRODUCTION_PROXY_ORIGIN`: production proxy origin. Omit this only when
  using the default `https://tribunal-proxy.fly.dev`.

Keep long-lived runtime application secrets in Fly. The deploy workflow does not
copy database, Redis, GitHub App, Anthropic, encryption, proxy signing, or control
token secrets into GitHub Actions. It only publishes a fresh Tensorlake reviewer
image and stages the returned `TRIBUNAL_SANDBOX_IMAGE` value on
`tribunal-engine` before deploying the engine.

The automatic deploy still assumes these one-time operator actions are complete:

- Fly apps exist.
- `tribunal-proxy` has a dedicated IPv4.
- Runtime Fly secrets are set on each app.
- Neon Auth, GitHub OAuth, and GitHub App production console settings are set.
- `REVIEWS_ENABLED` remains `false` unless live reviews are enabled separately
  through the runbook.

## Preflight Gates

Run these before the first deploy:

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

Deploy in dependency order after migrations:

```sh
flyctl deploy . --config deployment/fly/proxy.toml
flyctl scale count 1 --yes -a tribunal-proxy

flyctl deploy . --config deployment/fly/engine.toml
flyctl scale count 1 --yes -a tribunal-engine

flyctl deploy . --config deployment/fly/web.toml
flyctl scale count 1 --yes -a tribunal-web
```

## Health Gates Before Live Reviews

Before changing `REVIEWS_ENABLED` to `true`, all of these must be true:

- `tribunal-proxy` has a dedicated public IPv4.
- `TRIBUNAL_PROXY_CIDR` is the proxy IPv4 with `/32` on engine and proxy.
- `tribunal-web`, `tribunal-engine`, and `tribunal-proxy` each have exactly one
  non-destroyed Machine.
- `tribunal-engine` has no public IP address.
- `tribunal-engine` has a private Flycast IPv6 address and web uses
  `http://tribunal-engine.flycast`.
- Neon production endpoint `ep-round-dew-ap98dps9` reports
  `suspend_timeout_seconds: 300`.
- Proxy, engine, and web health checks pass.
- Unauthorized proxy requests return `401` or `403`.
- The fake review-engine load harness passes.
- `TRIBUNAL_SANDBOX_IMAGE` points at a released Tensorlake image identifier.

Use `documentation/deployment/containers.md` for the exact health check commands.

## Do Not Set In Production

- `WEFT_DATABASE_URL` on `tribunal-web`.
- `TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE`.
- `E2E_TEST_MODE`.
- Real secrets in committed files.
- `REVIEWS_ENABLED=true` before every health gate passes.
