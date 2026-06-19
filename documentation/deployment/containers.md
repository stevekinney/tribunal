# Container Deployment

Tribunal deploys as three long-running services plus managed Postgres and Redis:

- `web`: SvelteKit server for UI, API routes, and GitHub webhooks.
- `engine`: durable review engine. This service must run exactly one replica per `WEFT_DATABASE_URL`.
- `proxy`: credential-injecting egress broker for sandbox traffic.

The container definitions live in `deployment/containers/`:

- `web.Dockerfile`
- `engine.Dockerfile`
- `proxy.Dockerfile`
- `reviewer.Dockerfile`

Build checks:

```sh
docker build -f deployment/containers/web.Dockerfile -t tribunal-web:test .
docker build -f deployment/containers/engine.Dockerfile -t tribunal-engine:test .
docker build -f deployment/containers/proxy.Dockerfile -t tribunal-proxy:test .
docker build -f deployment/containers/reviewer.Dockerfile -t tribunal-reviewer:test .
```

## Ports

Every service reads the injected `PORT` environment variable:

- `web`: defaults to `3000` through SvelteKit adapter-node.
- `engine`: defaults to `3001`.
- `proxy`: defaults to `3002`.

The CI container harness boots the long-running application images on
non-default ports and calls `/health`. The reviewer image is a sandbox image,
not an HTTP service; CI runs its image self-check command instead of probing a
port.

## Health

`/health` is a readiness endpoint, not just a process liveness endpoint.

`web` reports:

- `database`: `DATABASE_URL` is configured.
- `redis`: `REDIS_URL` is configured.

`engine` reports:

- `weft_database`: the durable Weft database is reachable.
- `singleton_lock`: the process holds the advisory singleton lock.

CI may set `TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE=1` only for image boot
tests. Production must leave that flag unset so startup fails unless durable
storage is configured.

`proxy` reports:

- `configuration`: proxy configuration parsed successfully.
- `credential_resolver`: the credential resolver is available.

Production wiring should make the engine health check fail if either the Weft database check or the singleton lock check fails. A second engine process against the same durable store must fail fast and never report ready.

## Engine Replica Rule

Run `engine` with exactly one replica per durable store. The durable store is identified by `WEFT_DATABASE_URL`.

Why this is strict: Weft recovery resumes durable workflows from the store. Two engine processes on the same store can double-resume supervisors and duplicate comments, costs, or sandbox actions.

Required platform settings:

- Minimum replicas: `1`
- Maximum replicas: `1`
- Rolling deploy overlap: allowed only when the new process must acquire the singleton lock before it reports ready, and the old process must release the lock before the new one can become ready.
- Autoscaling: disabled for `engine`
- Autoscaling: allowed for `web` and `proxy`

## Redeploy Procedure

1. Apply database migrations before deploying application images.
2. Deploy `proxy` first when proxy configuration changed.
3. Deploy `engine` with max replicas still set to `1`.
4. Wait for `engine /health` to report `singleton_lock: true`.
5. Deploy `web`.
6. Run the post-deploy review-engine load harness against fakes before enabling live review traffic.

Do not enable live Tensorlake or external provider credentials for validation runs in CI. CI builds the reviewer image and application images only; pushing the reviewer image with `tl sbx image create` is a release operation that requires explicit live-service authorization.

## Local Verification

Targeted commands:

```sh
bun run --cwd applications/web test:unit:server -- --run test/load/review-engine-load-harness.test.ts src/routes/health/server.spec.ts
bun run --cwd applications/engine test -- src/health.test.ts src/index.test.ts
bun run --cwd applications/proxy test -- src/health.test.ts src/proxy.test.ts
bun run --cwd packages/agents test -- src/security-verification.test.ts src/hooks.test.ts
bun run --cwd packages/sandbox test -- src/security-verification.test.ts src/configuration.test.ts
```
