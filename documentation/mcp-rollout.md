# MCP rollout: flag, rollback trigger, and alerting

Decision document for TRI-26. `/mcp` will be Tribunal's first public
bearer-authenticated HTTP surface—the [orchestration
document](mcp-integration-orchestration.md) mounts it inside
`applications/web/src/hooks.server.ts` via Tribunal's own handle, built on the
published MCP engine, alongside a full OAuth 2.1 authorization server and its
`.well-known` discovery documents. (This document was drafted when that mount
was to be Protokit's ported `createApplicationMount()`; the orchestration
document rejects that seam. Nothing this document decides depends on which of
the two supplies the mount.) This document proposes answers to the three operational
questions the issue names.

Status: approved — merged as
[#321](https://github.com/stevekinney/tribunal/pull/321) and squashed to
`50e1b799`, with the user's approval recorded as completion evidence on
TRI-26. Approval covers the three questions the issue named: the flag, the
rollback trigger, and the alerting. It does not close the items this
document explicitly hands to whoever implements or operates the surface —
those are collected under "Summary of open questions for the approver" at
the end and marked `OPEN QUESTION` in place. Treat those as deferred with an
owner, not as a decision still pending.

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
admin panel or database row involved. The value is read once at process start (`parseEngineEnvironment`) and threaded through to where it is actually enforced, and the precise layer matters because it is the precedent `MCP_ENABLED` should follow.

The enforcement is **not** in the scheduler. `createReviewIntentKickScheduler` still calls `runtime.drainReviewIntents()` when the flag is false — its own disabled-scheduler test asserts that call happens. The effective gate is one layer down: `applications/engine/src/index.ts` passes `reviewsEnabled` into `createReviewIntentKickScheduler` — the scheduler, which is not the gate. The gate is wired separately: `createReviewIntentConsumer` in `applications/engine/src/workflows/runtime-ports.ts` parses `REVIEWS_ENABLED` **independently**, with its own `parseBooleanFlag` call, and passes the result to `createDatabaseReviewIntentPort`, whose `claimNextReviewIntent` returns `null` outright when `options.reviewsEnabled === false`.

Note what that means: `REVIEWS_ENABLED` is read and parsed in **two separate places**, for two different consumers, with no shared derivation. That is worth carrying to `MCP_ENABLED` as a warning rather than a pattern — two independent parses of one flag is exactly how the two ends drift apart. The drain loop still runs; it simply never gets an intent to work on.

The lesson to carry to `MCP_ENABLED` is that the flag is enforced at the point where the privileged thing is _acquired_, not at the outer loop that looks like the entry point. An outer-layer check that leaves the inner acquisition ungated is the shape this codebase has already shipped.

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
already uses, flipped to `"true"` only after the gates below pass and a
human approves the flip.

### Pre-enable gates

These are the gates. An earlier draft of this document pointed at the Disabling and Alerting sections as though they contained launch gates; they do not — they describe when to turn the surface off and which alerts to wire. Making nonexistent gates the sole prerequisite for `MCP_ENABLED = "true"` would let an operator expose the surface without ever proving the flag is wired, which is the exact failure this document exists to prevent.

Each is binary and runs against the deployed production host. They are **not** all run in the same state — an earlier draft said to re-run every check after flipping the flag, which is impossible, because the dark checks pass only while the surface is off. The states are separate and ordered.

**Stage one, with `MCP_ENABLED = "false"`.**

1. **The surface is fully dark.** Every one of `/mcp`, the OAuth authorize, token, refresh, revoke, and registration endpoints, and both discovery metadata documents returns the disabled response — not a 200, not a stack trace. Enumerate the paths from the route table rather than from memory; a path nobody remembered to gate is the whole risk. Record the expected status per route so stage three has something exact to compare against.
2. **The gate is at the acquisition point, not an outer layer.** A test asserts the flag is read where the mounted handler is acquired, and fails if that read is removed. This is check 1's structural counterpart, and it exists because the `REVIEWS_ENABLED` precedent shows the outer loop still running while the inner acquisition is what actually gates. This one is environment-independent and can run in CI.
3. **The refresh-replay notification reaches its sink.** Emit a synthetic replay event and confirm it arrives where a human sees it. An alert wired to nothing is indistinguishable from an alert that never fired, and this is the one alert this release depends on.

**Stage two: a temporary enabled window, used to run every enabled-state check and to exercise the disable path.** The surface must not be left publicly enabled before its authorization checks have passed, so this window ends with the surface off again, and the final enable happens only after every check below and human approval have succeeded.

Flip the flag on, then run all of:

4. **The surface serves what it should.** `/mcp` responds to an authenticated request, both discovery documents return their metadata, and the OAuth endpoints return their real responses rather than the disabled one. The positive counterpart to check 1, with its own expected status per route.
5. **Nothing that should stay closed opened.** Unauthenticated and under-scoped requests still fail, and `conformance:read` remains unobtainable. Enabling must not be the moment an authorization check quietly stops applying.
6. **Refresh-token reuse is rejected.** Exchange a refresh token, then replay the old one, and require rejection with no second access token minted. This check exists because the Alerting section establishes that a defect which silently _accepts_ reuse may emit no `refresh_replay` event at all — so without an active probe, every other gate here can pass while the deployment already meets the rollback condition. Nothing else on this list would notice.
7. **Cross-user subscription isolation holds.** With two separate fully-scoped users subscribed, confirm each receives only its own events. The shared `McpHttpHandler` failure the invariant list records is invisible to every other check here, and a cross-user delivery is an immediate rollback condition further down this document — it must not be discovered in production.

Then **disable the surface using the durable override** from the Disabling section, and confirm every route from check 1 returns to its dark response. A kill switch first exercised during an incident is an untested code path in the worst possible conditions, and this window is the only opportunity to run it without one.

**Stage three: enable for real,** after checks 4 through 7 have passed and a human has approved.

This is a three-step transition, not a flag flip, and the order matters. Stage two deliberately left the surface disabled behind an override built to survive redeploys, so simply setting the TOML value would leave that override still shadowing it — and enabling from a local checkout without committing would be undone by the next automatic deploy of the committed disabled value. Either way the operator would believe the surface is enabled when it is not.

1. **Land the approved enabled state on `main`.** Set `MCP_ENABLED = "true"` in `deployment/fly/web.toml` and merge, so the committed state is the intended one and the automation reinforces it.
2. **Clear the stage-two override**, explicitly and as its own step. It was designed to outlive a redeploy; nothing removes it implicitly.
3. **Verify.** Re-run check 4 and confirm the surface actually serves. This step is what catches having done 1 without 2, which otherwise looks identical to a deploy that has not landed yet.

Checks 1, 2, and 4 belong to whichever issue implements the flag. Checks 3, 5, 6, 7 and the stage-two disable exercise belong to TRI-60. None is satisfied by a merged pull request.

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
a requirement for the implementation tier (TRI-44's environment-schema work
and whichever issue mounts Tribunal's MCP and OAuth handle):

- `MCP_ENABLED` must be declared in whatever Zod environment schema the web
  application ends up with. Today `applications/web` has no centralized
  schema of the kind `applications/engine/src/environment.ts` and
  `applications/proxy/src/environment.ts` already have; it reads
  `$env/dynamic/private` values ad hoc at each call site (see
  `hooks.server.ts`, `redis.ts`, `encryption.ts`, and others). TRI-44 creates
  that schema, and `MCP_ENABLED` belongs in it with the same
  `booleanFlag`-style strict parsing engine already uses, never
  `z.coerce.boolean()` — `Boolean("false")` is `true`, so a coerced flag set
  to `"false"` silently enables the surface.

  **The schema is Tribunal's own, not a copy of the engine's.** An earlier
  revision said to port Protokit's `environment-schema.ts` into the web
  application, written when the engine was to be forked. Under the
  dependency model the MCP environment module belongs to the published
  package and TRI-44 keeps only Tribunal's web-surface half. Recreating the
  library's internals here would both duplicate a dependency and risk
  inheriting its defaults — in particular a `NODE_ENV` default, where the
  orchestration document's invariant is that **`NODE_ENV` has no default**
  and every fail-closed production check depends on that. Take the
  invariants from the orchestration document, not the schema shape from the
  package.

- The flag must be checked in the `sequence(...)` chain in
  `applications/web/src/hooks.server.ts`, before the handle that mounts the
  MCP and OAuth routes, and it must short-circuit every path that
  chain owns: `/mcp` itself, the OAuth authorization/token/registration
  endpoints, and the `.well-known` discovery documents, not just the MCP
  JSON-RPC endpoint.
- **What the surface returns while disabled: `404`, and TRI-41 owns
  recording it.** A bare `404` is indistinguishable from "this route was
  never built," which is the right posture for a security-relevant surface
  — do not confirm the surface exists to an unauthenticated prober. A `503`
  would be more honest operationally but confirms the surface is real. This
  document recommends `404` for the same reason `/metrics` and
  `/health/ready` return `404` rather than `401` when unconfigured in
  Protokit's own RUNBOOK access-control section.

  **Decided by the project owner on 2026-08-27, on the grounds of what is
  idiomatic.** This is no longer a recommendation awaiting sign-off. **TRI-41
  ships `404` and records the per-route expected-status table gates 1 and 4
  compare against**, since criterion 6 already makes it the issue that
  honours the flag.

  Three reasons beyond the disclosure argument above, each of which
  independently rules out `503`:

  - **`503` invites a retry that should never happen.** RFC 9110 defines it
    as the server being _temporarily_ unable to handle the request; it is
    the status that pairs with `Retry-After` and that clients back off and
    retry against. A deliberately disabled surface is not temporarily
    unavailable in any sense a client should wait out, so `503` would have
    every MCP client politely retrying a surface that is off on purpose.
  - **`404` is how discovery is _supposed_ to fail.** A client reads
    `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
    to learn whether this host offers an OAuth-protected MCP surface at all.
    A `404` answers that question — no, degrade gracefully — which is the
    path clients already implement. A `503` leaves them unable to
    distinguish "not offered" from "offered and briefly sick."
  - **It makes gate 1 a clean binary.** These are SvelteKit routes, so a
    route that is not mounted returns `404` on its own. Choosing `404` makes
    the disabled state byte-identical to the never-built state, which is
    exactly what "the surface is fully dark" needs to mean if it is to be
    asserted rather than inspected.

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

### The flag flip as written is not durable, and that is a defect in this procedure

Two facts about how this repository deploys make the TOML edit above unsafe to rely on during an incident, and both were verified rather than assumed:

- `flyctl deploy . --config deployment/fly/web.toml` builds from the repository root, as `scripts/deploy.ts` documents. An operator whose checkout differs from production therefore ships that checkout alongside the flag change. The mechanism intended to change one value can change the running code.
- `.github/workflows/deploy-production.yml` triggers on `workflow_run` of CI on `main` with `conclusion == 'success'`. **Every successful main build redeploys production automatically.** If the flag edit is local-only, the next merge to `main` silently redeploys committed `MCP_ENABLED = "true"` and reopens the surface, with no operator action and no signal that it happened.

So the disable procedure needs a durable, config-only override that an automated deploy cannot undo. This document does not settle which mechanism, because the candidate needs verifying against Fly's actual precedence rules and TRI-60 owns production configuration. **What it does require is that the mechanism satisfy three properties, and that TRI-60 not consider itself finished until one does:**

1. It changes configuration only, never the running image.
2. It survives an automatic redeploy triggered by a subsequent merge to `main`.
3. Turning it back on is a deliberate act, not a side effect of the next deploy.

The obvious candidate is a Fly secret shadowing the `[env]` value, since secrets are set out of band and are not rewritten by a deploy. That must be _confirmed_ — that a secret genuinely takes precedence over the same key in `[env]` in `web.toml`, and that a subsequent `flyctl deploy` does not clear it — before anyone relies on it in an incident. An unverified kill switch is worse than a documented manual one, because it will be trusted at the exact moment it matters.

Calling release rollback the durable fallback was wrong, and it is worth being precise about why, because the same automation defeats it. `deploy-production.yml` redeploys web from the committed TOML on every successful push to `main`. A rolled-back release is therefore replaced by a new one carrying `MCP_ENABLED = "true"` at the next ordinary merge — the same reversal, just triggered by someone else's unrelated pull request rather than by the operator's own deploy.

**Neither mechanism above is durable on its own, because both fight the automation instead of accounting for it.** A disable is durable only when the committed state agrees with it. The procedure is therefore two steps, and the second is not optional:

1. **Stop the bleeding out of band.** Apply the config-only override, whatever TRI-60 confirms it to be, to take the surface down now without waiting on CI.
2. **Land the flag change on `main`.** Set `MCP_ENABLED = "false"` in `deployment/fly/web.toml` and merge it. This is what makes the disable survive: the next automatic deploy now redeploys the _disabled_ state, so the automation reinforces the decision instead of reversing it.

**This two-step procedure assumes the flag actually covers the surface. When it does not, it makes things worse, and that is the case release rollback exists for.** If `/mcp` was disabled precisely because the gate turned out not to cover every mounted route, then committing `MCP_ENABLED = "false"` does nothing for the uncovered routes — and the next automatic deploy replaces the safe pre-MCP release with the vulnerable build carrying an inert flag. The disable would appear to be holding while the exposure returned.

In that branch the flag is not the remedy. Either revert the mount itself so the vulnerable build is not what gets deployed, or pause the production deploy workflow until the surface is genuinely fixed. Decide which branch you are in before choosing: **is the flag failing to be applied, or failing to cover?** The first is a durability problem and the two steps above solve it; the second is a code problem and no configuration value will.

Step 1 without step 2 is a timer counting down to the next merge, with nothing announcing when it expires. If step 2 cannot be merged promptly, the automation itself must be paused, and the procedure should say so explicitly rather than leaving an operator to discover the reversal from a production incident.

### Binary condition

Recommendation: disable `/mcp` — **using the config-only override first**,
not the TOML flag flip, then landing the committed change and escalating to
release rollback if the flag path does not resolve it, exactly as the
Disabling section sequences it — on any single confirmed
occurrence of an authentication or authorization boundary failure,
concretely, any of:

- a refresh token accepted a second time after having already been
  exchanged (a replay),
- any request reaching a tool handler or resource read without a valid,
  audience-checked bearer token, or
- any request receiving `resources/subscribe` or `subscriptions/listen`
  events scoped to a different authenticated user than the one who made
  the request, or
- any `subscriptions/listen` delivery made without the scope
  `resources/read` requires, **even when the recipient is the correct
  user**.

That last condition needs stating separately because the other three do not
reach it. A caller holding an audience-valid token for its own account, but
lacking the required scope, is neither unauthenticated nor receiving another
user's events — so a delivery to it would satisfy every other condition here
while still being the exact scope-enforcement bypass the orchestration
document's invariant list names as a confirmed defect in the donor. Same user,
wrong scope, still a boundary failure.

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

Every claim below about Protokit's RUNBOOK conditions, event names, and source locations is read from the pinned donor revision `6eb354e43ecc48efdac8abe59daea82dcdab88fd` on [`stevekinney/protokit`](https://github.com/stevekinney/protokit), fixed by TRI-67. Verify against that revision rather than any local checkout, and locate cited code by symbol rather than line number — the same commit rewrote parts of the donor's environment modules.

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
and the sink are new.

An earlier revision said the logger and collector "arrive with the port
itself", which was true of a fork and is misleading as a dependency. They
arrive inside the published engine, which owns its own `pino` instance —
so engine log lines do **not** inherit Tribunal's redaction policy by
arriving. That is the gap TRI-76 (host-supplied logger) closes, letting
Tribunal supply a logger that already redacts and having the engine's
output inherit it. Until then, treat engine-emitted lines as outside the
TRI-33 policy rather than covered by it, and do not read the presence of a
logger in the dependency as evidence redaction is in force.

Either way nothing consumes them into an actual alert without further work
this issue's acceptance criteria require naming explicitly.

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

Refresh replay is the one condition that needs no rate aggregation, dashboard, or pre-existing baseline: a single structured log line is sufficient signal, and it needs no investment beyond routing that one event somewhere a human sees it.

**But the alert and the rollback trigger are not the same event, and conflating them is a mistake.** A correctly implemented rotation flow _detects and rejects_ reuse before emitting `refresh_replay`, so that log line is evidence of a **rejected** attempt — which is the control working, not failing. The Binary condition section is deliberately narrower: it requires a token **accepted** a second time.

Two things follow, and both matter:

- **Do not make one `refresh_replay` line disable `/mcp`.** Any authorized client could then provoke a service-wide outage by deliberately replaying its own rotated token. That is a denial-of-service vector handed to every client.
- **Do not treat the absence of `refresh_replay` as evidence of health.** The defect that actually meets the rollback condition — a flow that silently _accepts_ reuse — may emit no replay event at all, precisely because nothing detected it.

So: alert on rejected replay attempts, because a burst of them is a real signal worth a human's attention. Require separate evidence that acceptance occurred before triggering rollback. Whatever detects acceptance is a different check from the one that emits this log line, and TRI-38 owns building it.

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
this one alert, and **deduplicated per token family**.

The deduplication is not a nicety. The Binary condition section removed the
service-wide outage vector by refusing to let one replay event disable `/mcp`,
but forwarding every event to a chat channel leaves the same client-controlled
lever pointed at the humans instead of the service: an authorized client can
resubmit one already-rotated token in a loop and flood the channel, which ends
with the alert muted and the next real replay unseen. Notify on the **first**
occurrence per token family, suppress or rate-limit the rest, and keep
recording every occurrence in structured logs so the count survives for
investigation.

Concretely, a Slack incoming webhook fired on the first
`refresh_replay` event per family, carrying nothing beyond the token family
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

This list is what approval did **not** settle. One item has since been
closed and is recorded here so the two halves of this document cannot give
opposite instructions:

- ~~The exact HTTP response while `MCP_ENABLED` is false.~~ **Closed —
  `404`, decided by the project owner on 2026-08-27.** TRI-41 ships it and
  records the per-route expected-status table that rollout gates 1 and 4
  assert against. The reasoning is in the flag section above: `503` invites
  a retry that should never happen, `404` is how OAuth discovery is meant to
  fail, and it makes the disabled state identical to the never-built state
  so gate 1 is assertable. This is settled — implement it rather than
  stopping for approval.

Still open:

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
