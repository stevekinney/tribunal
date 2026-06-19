# D Container Deploy and Load

Status: blocked on live deployment authorization

## Done

- Added Docker build definitions for `web`, `engine`, `proxy`, and the reviewer sandbox image.
- Added CI container harness coverage for building images and booting app containers on injected ports.
- Added reviewer image runtime import verification for `@anthropic-ai/claude-agent-sdk` and `@tribunal/agents`.
- Added dependency-aware health response tests for web, engine, and proxy.
- Documented the one-replica engine rule and redeploy procedure.
- Added fake-only load harness for 20 repositories, 10 concurrent pull requests, synchronize bursts, duplicate comment checks, duplicate cost-event checks, sandbox cleanup, and spend cap checks.
- Ran `bun run verify`; it passed.

## Left

- Build images against a running Docker daemon.
- Deploy to a container host and prove post-deploy health.
- Push or publish the Tensorlake reviewer image.
- Run a live post-deploy load check.

## Failures

- Local Docker verification could not run because the Docker daemon was unavailable.
- Live deploy and Tensorlake image publish require explicit live-service authorization.

<promise>TRACK_D_BLOCKED</promise>
