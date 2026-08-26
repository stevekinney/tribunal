# MCP rollout: flag, rollback trigger, and alerting

Decision document for TRI-26. `/mcp` will be Tribunal's first public
bearer-authenticated HTTP surface—the [orchestration
document](mcp-integration-orchestration.md) mounts it inside
`applications/web/src/hooks.server.ts` via a ported `createApplicationMount()`,
alongside a full OAuth 2.1 authorization server and its `.well-known`
discovery documents. This document proposes answers to the three operational
questions the issue names. It is a draft; nothing here is approved until a
human signs off, per the issue's own instruction not to self-approve a
decision issue.

Each section states the options considered, a recommendation, and the
reasoning. Anything the codebase does not currently answer is marked
`OPEN QUESTION` rather than guessed at.

## Rollout flag

### The existing pattern

Tribunal already ships one go-live gate of this shape: `REVIEWS_ENABLED` on
`tribunal-engine`. Its schema declaration defaults it open—`REVIEWS_ENABLED: booleanFlag.default(true)` in `applications/engine/src/environment.ts`—but
production safety comes entirely from `deployment/fly/engine.toml` pinning
`REVIEWS_ENABLED = "false"` as a committed, non-secret `[env]` value.
`DEPLOYMENT.md` and `documentation/deployment/containers.md` both spell out
the same rule in prose: reviews stay off until every item under "Health
Gates Before Live Reviews" passes, and only then does an operator hand-edit
the TOML and run `flyctl deploy . --config deployment/fly/engine.toml` to
flip it. Flipping the flag is a redeploy, not a runtime toggle—there is no
admin panel or database row involved. The value is read once at process
start (`parseEngineEnvironment`) and threaded through to the one place it
is enforced: `createReviewIntentKickScheduler`'s drain loop in
`applications/engine/src/index.ts`, which never claims queued review
intents while `reviewsEnabled` is false.

Two more flags in the same schema follow the same shape with the safer
default baked into the schema itself, not just the TOML:
`ENABLE_PROMPT_CACHING_1H: booleanFlag.default(false)` and
`WEFT_INSPECTOR: booleanFlag.default(false)`. Parsing is strict
string-equality (`'true' | '1'` versus `'false' | '0'`) in both the Zod
`booleanFlag` transform and the standalone `parseBooleanFlag` helper in
`applications/engine/src/workflows/runtime-ports.ts`—never
`z.coerce.boolean()`, which the orchestration document's
verification-discipline section calls out by name as a banned pattern for a
security-relevant flag (`Boolean("false")` is `true`).
`applications/web/src/hooks.server.ts` already reads a boolean-shaped
environment variable the same strict way: `env.E2E_TEST_MODE === '1'`.

### Options

- **Mirror exactly**: a flag defaulting open in schema, closed only by the
  committed TOML value, the same as `REVIEWS_ENABLED`.
- **Mirror the mechanism, depart on the default**: same committed,
  non-secret `[env]` value on the Fly app that serves it, flipped by editing
  TOML and redeploying, strict-equality parsed—but the schema itself
  defaults closed, matching `ENABLE_PROMPT_CACHING_1H` and `WEFT_INSPECTOR`
  rather than `REVIEWS_ENABLED`.
- **No flag**: rely on the merged pull request and a Fly image rollback as
  the only on/off control, the same as every other route in the application
  today.

### Recommendation

Mirror the mechanism, depart on the default. Name the flag `MCP_ENABLED`,
defaulting to `false` in the schema. Ship `deployment/fly/web.toml` with
`MCP_ENABLED = "false"` from the first deploy that includes the mounted
surface, the same committed non-secret `[env]` value `REVIEWS_ENABLED`
already uses, flipped to `"true"` only after the launch gates in the
Disabling `/mcp` in production and Alerting sections below are satisfied
and a human approves the flip.

`REVIEWS_ENABLED`'s open-by-default schema value only stays safe because a
human has to remember the TOML also says `false`—the two declarations can
drift, and this codebase has already hit that exact failure shape three
times according to the orchestration document's verification-discipline
section ("configuration added to a schema but never wired into the gate
meant to enforce it," tracked structurally by TRI-57). `REVIEWS_ENABLED`
gates a background worker loop with no exposed attack surface if the
default silently reverted; `/mcp` gates a public,
unauthenticated-until-bearer-checked HTTP endpoint plus an OAuth
authorization server and DCR endpoint. A schema-level default of `true`
here means an operator who forgets to check the TOML, or a fresh
environment that never had the TOML value copied over, ships the surface
open by accident. A schema-level default of `false` fails closed in that
same scenario. `ENABLE_PROMPT_CACHING_1H` and `WEFT_INSPECTOR` already
establish that a `booleanFlag.default(false)` shape is normal in this
codebase; this is not a new pattern, just applying the existing safer
variant to a security-relevant flag instead of the riskier one
`REVIEWS_ENABLED` happens to use.

The "no flag" option is rejected: `/mcp` shipping means an OAuth
authorization server and dynamic client registration reachable from the
internet start accepting traffic the moment the merged code deploys, with
no way to turn it back off short of a full Fly image rollback of
`tribunal-web` (which would also revert every other change bundled into
that deploy). A dedicated flag decouples "the code is safe to deploy" from
"the surface is safe to expose," the same separation `REVIEWS_ENABLED`
already buys the review engine.

Rejected the "gate `/mcp` only" narrower framing too: the flag must gate
the entire mounted surface, not just the `/mcp` route handler. If
`MCP_ENABLED` is false but the OAuth `.well-known` discovery documents, the
authorization and token endpoints, or dynamic client registration keep
responding, the service is not actually off—it is advertising an
authorization server for a resource that refuses to work, and a scanner or
curious client can still probe it. This is the same "declared but not
fully wired" failure shape called out above, just spread across a route
surface instead of a single schema field.

### Where it must be read and enforced

None of this code exists yet—`/mcp` has no implementation in this
repository as of this document, so nothing below is a file citation, it is
a requirement for the implementation tier (TRI-44's environment-schema port
and whichever issue mounts `createApplicationMount()`):

- `MCP_ENABLED` must be declared in whatever Zod environment schema the web
  application ends up with. Today `applications/web` has no centralized
  schema of the kind `applications/engine/src/environment.ts` and
  `applications/proxy/src/environment.ts` already have; it reads
  `$env/dynamic/private` values ad hoc at each call site (see
  `hooks.server.ts`, `redis.ts`, `encryption.ts`, and others). The
  orchestration document's TRI-44 invariants describe porting Protokit's
  own Zod-validated `environment-schema.ts`, so by the time `/mcp` ships a
  schema should exist; `MCP_ENABLED` belongs in it with the same
  `booleanFlag`-style strict parsing engine already uses, not
  `z.coerce.boolean()`.
- The flag must be checked in the `sequence(...)` chain in
  `applications/web/src/hooks.server.ts`, before whatever handle mounts
  `createApplicationMount()`, and it must short-circuit every path that
  chain owns: `/mcp` itself, the OAuth authorization/token/registration
  endpoints, and the `.well-known` discovery documents, not just the MCP
  JSON-RPC endpoint.
- `OPEN QUESTION`: what response the surface returns while disabled. A
  bare `404` is indistinguishable from "this route was never built," which
  is arguably the right posture for a security-relevant surface (do not
  confirm the surface exists to an unauthenticated prober). A `503` would
  be more honest operationally but confirms the surface is real. This
  document recommends `404` for the same reason `/metrics` and
  `/health/ready` return `404` rather than `401` when unconfigured in the
  donor RUNBOOK's own access-control section, but leaves the final call to
  whoever approves this document.

## Disabling `/mcp` in production

### Mechanism

Two disable mechanisms exist once `MCP_ENABLED` ships, at different layers:

- **Flag flip** (primary): edit `deployment/fly/web.toml`'s `MCP_ENABLED`
  value to `"false"` and run
  `flyctl deploy . --config deployment/fly/web.toml`. Keeps the current
  code running, turns off only the mounted surface. This is the right tool
  when the surface itself, not the rest of `tribunal-web`, is the problem.
- **Release rollback** (fallback): `flyctl releases rollback <version> -a tribunal-web`
  per the existing procedure in `documentation/deployment/containers.md`'s
  Rollback section, re-run health gates afterward. This is the right tool
  when the flag mechanism itself is suspect—for example, if the gate is
  found not to actually cover the whole mounted surface, flipping the flag
  would not be trustworthy, and the only safe move is reverting to a build
  that never mounted the surface at all.

### Binary condition

Recommendation: disable `/mcp` (flag flip first, escalate to release
rollback if the flag path does not resolve it) on any single confirmed
occurrence of an authentication or authorization boundary failure,
concretely, any of:

- a refresh token accepted a second time after having already been
  exchanged (a replay),
- any request reaching a tool handler or resource read without a valid,
  audience-checked bearer token, or
- any request receiving `resources/subscribe` or `subscriptions/listen`
  events scoped to a different authenticated user than the one who made
  the request.

This deliberately mirrors the donor RUNBOOK's own framing for refresh
replay ("this should be rare-to-never in legitimate traffic; a single
occurrence is worth investigating, not just counting") and extends the
same single-occurrence bar to the two other invariants the orchestration
document calls out as confirmed historical defects in Protokit
(`subscriptions/listen` scope enforcement, per-user handler isolation). A
rate-based trigger (`N` occurrences per minute) is deliberately rejected
for these three: they should never happen even once against a
correctly-authorized client, so requiring a threshold before disabling
delays the response to a security event for no benefit. Sustained-rate
conditions (registration spikes, `invalid_resource`, `invalid_client`) are
alerting inputs, addressed below, but are not proposed as automatic
disable triggers; those can reflect a misbehaving legitimate client and
warrant investigation before cutting off the whole surface.

### Who may trigger it

The operator: anyone holding `flyctl` deploy access to `tribunal-web`, the
same authority level the codebase already grants for `REVIEWS_ENABLED`.
This is a stated answer, not a guess: this repository has no `CODEOWNERS`
file and no documented on-call rotation, and `DEPLOYMENT.md` and
`documentation/deployment/containers.md` both use "operator" as the only
role, singular, for every Fly-facing action, including the existing
`REVIEWS_ENABLED` flip. `OPEN QUESTION`: whether a narrower role should be
defined before launch, if Tribunal ever grows a team with narrower Fly
access than "the person deploying." Nothing in the current codebase or
documentation defines that narrower boundary today.

## Alerting

### The five conditions, and Tribunal's current alerting surface

Tribunal ships no logging or metrics infrastructure for `/mcp` today,
because `/mcp` does not exist yet. For context: the donor (Protokit) does
not either. Its `RUNBOOK.md` is explicit that "this repository ships no
hosted dashboard or alerting backend of its own," and every one of its
five alert conditions is defined as "a query an operator wires into their
own log aggregator or a threshold against `/metrics`," never a running
alert in the donor codebase. Tribunal's own web application today logs
with bare `console.log`/`console.error` (see
`applications/web/src/routes/api/webhooks/github/+server.ts`) and has no
`/metrics` endpoint, no pino instance, and no metrics collector of any
kind. So for `/mcp`, both the emitting side (the structured pino logger
with redaction, and the metrics collector Protokit's
`packages/mcp/src/logger.ts` and `packages/mcp/src/metrics.ts` provide)
and the sink are new. The logger and collector arrive with the port itself
(the orchestration document's TRI-33 invariant on redaction), but nothing
consumes them into an actual alert without further work this issue's
acceptance criteria require naming explicitly.

The five conditions from the issue, evaluated:

- **anonymous-registration spike**: needs rate aggregation over
  `oauth_client_registration` / `success` events grouped by network
  identity.
- **refresh-token replay on any single occurrence**: a single structured
  log event (`oauth_token_exchange` / `refresh_replay`) is sufficient; no
  aggregation needed.
- **sustained `invalid_resource` rate**: needs rate aggregation over
  `mcp_authentication` / `invalid_resource` and `oauth_token_exchange` /
  `invalid_resource` events.
- **sustained `invalid_client`/`expired_or_invalid_token` rate**: needs
  rate aggregation over `oauth_client_authentication` / `invalid_client`
  and `mcp_authentication` / `expired_or_invalid_token` events.
- **per-tool p95/p99 latency or error-rate regression against baseline**:
  needs both a metrics collector with per-tool percentile tracking and an
  established baseline to regress against.

### Recommendation: wire versus defer

Wire refresh-token replay for this release. Defer the other four.

Refresh replay is the one condition that needs no rate aggregation,
dashboard, or pre-existing baseline; a single structured log line is both
sufficient signal and, per the Binary condition section above, already the
recommended trigger for disabling `/mcp` outright. Wiring it once serves
both purposes: the alert and the rollback trigger are the same detection
mechanism, so there is no separate alerting investment beyond routing that
one log event somewhere a human sees it before the next request pattern
makes the decision for them.

The remaining four are deferred with distinct reasons, not one blanket
"later":

- Anonymous-registration spike and the two sustained-rate conditions all
  need rate aggregation this release has no infrastructure for: no log
  aggregator, no scheduled query runner, nothing in this codebase's
  dependencies (`package.json` across `applications/web` and
  `applications/engine`) resembling Sentry, Datadog, Grafana, or a Slack
  webhook client. Building that aggregation is out of scope for a
  first-launch decision document and belongs in its own tracked issue.
- Per-tool p95/p99 regression cannot be wired meaningfully at launch under
  any infrastructure choice: "regression against baseline" requires a
  baseline, and there is no production traffic to establish one from
  before the surface has shipped. Wiring this before there is a baseline
  to compare against would either alert on every request (no baseline
  means everything looks anomalous) or need to be disabled until one
  accumulates, which is functionally the same as deferring it.

Deferring is not a silent punt: per the standing "no silent deferral"
rule, each deferred condition should get its own tracked Linear issue at
the point `/mcp` actually ships, not left as a comment in this document.
This document recommends that whoever approves it also authorizes filing
those four follow-up issues (one per condition, or grouped, at the
approver's discretion) rather than treating this section as closing the
topic.

### Sink

Recommendation: a new, minimal outbound notification, scoped to exactly
this one alert. Concretely, a Slack incoming webhook fired only when a
`refresh_replay` event is logged, carrying nothing beyond the token family
id already permitted in that log line, no prompt or tool content. This is
the only sink this document can name concretely: it does not depend on
verifying a piece of existing infrastructure this codebase does not have,
only on adding one new credential (a webhook URL) the same way any other
secret in `DEPLOYMENT.md`'s Generated Secrets or Accounts and Artifacts
sections is provisioned.

The alternative considered and not recommended: routing through whatever
log destination Fly already forwards `tribunal-web`'s stdout to. This
would need no new credential, but this document cannot confirm such a
destination exists or is monitored; no log aggregator, Fly log-shipping
configuration, or equivalent appears anywhere in this repository's
`DEPLOYMENT.md` or `documentation/deployment/` content. Recommending it
would mean naming a sink this codebase gives no evidence is real.

`OPEN QUESTION`: whether the approver prefers the log-based route instead,
for example because a log aggregator already exists outside this
repository's documentation, and the exact webhook destination (which
Slack channel, or an alternative notification target) if the recommended
direction is approved.

## Summary of open questions for the approver

- The exact HTTP response (`404` versus `503`, or something else) `/mcp`
  and its OAuth endpoints should return while `MCP_ENABLED` is false.
- Whether the operator (anyone with `flyctl` deploy access to
  `tribunal-web`) is the intended authority for disabling `/mcp`, or
  whether a narrower role should be defined before launch.
- Whether the recommended webhook sink for the refresh-replay alert is
  approved, and if so, the exact destination; or whether a log-based route
  against an aggregator not documented in this repository should be used
  instead.
- Whether to file the four deferred alert conditions as follow-up issues
  now or at the point `/mcp` actually ships.

## Verification

```sh
test -f documentation/mcp-rollout.md
bun run format:check
```
