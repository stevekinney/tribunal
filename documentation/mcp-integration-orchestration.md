# Orchestrating the MCP server integration

Standing instructions for the agent driving the MCP server integration. Written to be self-contained: it assumes no memory beyond this repository, its git history, Linear, and this document.

## Mission

Drive the Linear project [Tribunal MCP Server Integration](https://linear.app/lost-gradient/project/tribunal-mcp-server-integration-b7d2b5df1f49) (team `TRI`, 43 issues, TRI-23 through TRI-65) to completion: Tribunal's SvelteKit web application serves an authenticated MCP server at `/mcp` with a full OAuth 2.1 authorization server, and Claude Code, Codex CLI, the Claude hosted connector, and ChatGPT developer mode each complete OAuth and invoke a Tribunal tool against the deployed production host.

Linear is the source of truth for what to do. This document is the source of truth for how to do it and what must not be lost along the way.

## Repositories

**This repository is where all work happens.** Every one of the 43 issues is labeled `repo:tribunal`.

**Protokit is an upstream dependency, not a read-only donor.** This reverses the model the project was originally scoped against, and it is the most important thing on this page.

The original framing was that Protokit is a template to copy from and must never change. That is no longer true. The reusable MCP engine is being **published from Protokit and consumed by this repository as a dependency**, so Protokit now takes pull requests, and work that belongs to the engine belongs upstream rather than here.

The practical test for where a change goes: **does it describe the MCP protocol engine, or does it describe Tribunal?** Engine behaviour — transport, scope enforcement mechanics, tool-response bounds, conformance fixtures — goes upstream. Tribunal's own surface — which tools exist, which scopes they gate, how a user is identified, how the surface is rolled out — stays here.

**Its availability is settled.** TRI-67 chose option (a), pin an immutable revision. The donor is pinned to `6eb354e43ecc48efdac8abe59daea82dcdab88fd` on [`stevekinney/protokit`](https://github.com/stevekinney/protokit), reachable on `origin/main`. Use that revision for every port issue; do not read the author's working tree.

**The premise that made TRI-67 hard is gone, and should not be relitigated.** When this project was scoped, `~/Developer/protokit` carried roughly 85 uncommitted local modifications. That is what made the prerequisite real: no fresh checkout, hosted agent, or CI run could execute the port issues, and the audit that produced this project had read the working tree rather than any commit. That working tree has since been committed and pushed. `a67383b` added the embedding seams and `6eb354e4` replaced `@t3-oss/env-core` with `@lostgradient/environmentalist`, and the checkout is now clean at exactly `origin/HEAD`. Every file TRI-67 named as dirty — `oauth-routes.ts`, `mcp-handler.ts`, `redis-client.ts`, `google-authentication.ts`, and the `env.ts` modules — is committed at the pinned revision.

Verified from a clean clone rather than reasoned about:

```
git clone https://github.com/stevekinney/protokit.git
git -C protokit checkout 6eb354e43ecc48efdac8abe59daea82dcdab88fd
```

Both commands exit 0. The `-C` matters: `git clone` creates the directory but does not change the shell's working directory, so a bare `git checkout` afterwards runs in the caller's repository and exits 128.

**Option (c) has since been taken, in its narrower form.** TRI-67 chose (a) to unblock the port tier without foreclosing anything, and recorded that (a) was reversible. It has now been reversed deliberately: the engine is published from Protokit and consumed here.

Two grains of (c) were considered and the first was chosen:

- **Publish the engine** (chosen). Protokit ships `packages/mcp` as a public package; Tribunal replaces its copy with a dependency and continues building its own application layer — OAuth endpoints, consent screen, identity binding — on top of it.
- **Embed the whole application** via `createApplicationMount()` (not chosen). This would have made Tribunal a host for Protokit's entire web application, which `EMBEDDING.md` documents as running into three walls: the donor's application layer has Google identity baked in, its `__Host-` session cookie cannot cross hosts, and migration metadata would need isolating. It also invalidates the locked Neon Auth decision.

The pinned revision above still matters. It is the baseline the published package is cut from, and the reference for reading engine source until a version is on a registry.

**Line references in TRI issue bodies are indicative, not exact.** Locate cited code by symbol name, not line number. Spot-checked at the pinned revision: `packages/mcp/src/env.ts:37-54` is an exact match, landing on the production refusal of `LOG_CONTENT_DIAGNOSTICS_UNTIL` that TRI-44 criterion 8 describes; `applications/web/src/routes/oauth-routes.ts:1204` lands inside `revokeOauthRefreshTokenFamily`, the right subject for TRI-38's refresh and revoke work; `applications/web/src/lib/production-startup-requirements.ts:462-469` lands on the Google credential production requirement, inside TRI-57's module though on content this project deletes by decision. One does not resolve: `applications/web/src/env.ts:37-54` now lands on Railway replica-identifier resolution, because `6eb354e4` rewrote 123 lines of that file.

A `repo:protokit` label exists in Linear and is applied to nothing. If that ever changes, note that Protokit has no owning Linear team and routing must be decided first.

An instruction that reads "delete `google-id-token.ts`" means _do not bring it across_, not _remove it from Protokit_.

## Decisions already made, not to be relitigated

- **Hosting**: `applications/web/src/hooks.server.ts` mounts **Tribunal's own** MCP and OAuth routes, built on the published engine. No new Fly app, Dockerfile, or `fly.toml`. The standalone-service alternative was rejected because the consent screen needs a logged-in user and a separate service cannot read this application's session cookie.

  This supersedes the original wording, which said to mount Protokit's `createApplicationMount()`. That seam mounts Protokit's entire web application, which is the grain of option (c) that was **not** chosen — it carries the donor's Google identity layer and its own session model, both of which this project's locked decisions replace. Use the engine's exports; do not mount the donor's application.

- **Identity**: Neon Auth with GitHub as provider is the sole source. Protokit's Google layer is deleted, not adapted. Reuse `applications/web/src/lib/server/auth/neon-session.ts`; do not port a second JWT validator.
- **Clients**: all four. This is why the stateless legacy `2025-11-25` protocol lane, CIMD, dynamic client registration, and the ChatGPT connector assets are in scope.
- **Test runner**: vitest. No `bun:test` enters this repository, enforced by lint rule in TRI-34.

Three decisions remain open and are tracked as issues: the scope vocabulary (TRI-24), the consent-flow session binding (TRI-25), and the rollout flag, rollback trigger, and alerting (TRI-26). Their outputs are inputs to the implementation tier. Do not guess them; drive each to a committed decision document.

## What the dependency model changes in the graph

The graph was authored as a fork: TRI-27 copies the engine, and TRI-32 through TRI-40 rebuild identity, OAuth endpoints, and the consent screen. Most of that survives unchanged, because Tribunal's application layer is Tribunal's either way. What moves is the engine-level work.

**Read this as analysis, not as settled scope.** Each issue below still needs its own description updated before anyone picks it up; this section says which ones and why, so the next reader is not misled by an issue body written against the fork model.

**Already done, now a bridge.** TRI-27 shipped `@tribunal/mcp` as a copy of the engine. That package is now temporary: it is replaced by the published dependency. It is not wasted — it proved the engine has zero database or web coupling, which is what makes publishing viable, and its 31 substantively-changed files are the requirements list for what the published package must abstract (runtime-agnostic environment handling, no `bun:test`, a version that survives bundling, an injectable logger).

**Moves upstream.** TRI-30 (conformance fixtures and conformance server) and TRI-33 (logger redaction) describe engine behaviour, not Tribunal's. Conformance proves the engine speaks the protocol; redaction is the engine's logger. Both belong in the published package, with Tribunal consuming the result. TRI-33 has a second option worth weighing: rather than owning redaction upstream, the engine grows an injectable logger seam and Tribunal supplies a logger that already redacts.

**Shrinks.** TRI-34 loses most of its scope: with no ported suites in this repository, there is nothing to convert from `bun:test`, and what remains is the lint rule that keeps `bun:test` out. TRI-44 splits: the MCP environment module belongs to the published package, while Tribunal's own web-surface invariants (`SKIP_ENV_VALIDATION`, `NODE_ENV` inlining against the Vite artifact, `sslmode=verify-full`, the coercion ban) stay here and remain the more important half.

**Unchanged.** Everything describing Tribunal's own surface: TRI-29 (which tools and resources exist), TRI-31 and TRI-35 through TRI-43 (the OAuth server and its mount), TRI-45 through TRI-61 (operations), and the four client release gates. The three decision documents stand as written — scopes, session binding, and rollout are Tribunal's regardless of where the engine lives.

## Working upstream

Protokit has no owning Linear team, so engine work is tracked as GitHub issues on [`stevekinney/protokit`](https://github.com/stevekinney/protokit) rather than in Linear. That is the documented fallback for a repository with no owning team, not an exception being made here.

Two consequences worth stating before the first upstream change:

- **A Tribunal issue blocked on upstream work has no native `blocked by` relation to express it.** Record the dependency in the issue body with a link to the GitHub issue, and do not move the Tribunal issue to `Ready` until the upstream change is released — a merged upstream pull request is not a released version.
- **Two defects found during the port exist in the donor too**, and are the first upstream candidates: the tool-result cap measures UTF-16 code units rather than UTF-8 bytes, and a present-but-unparseable `Origin` is treated as absent. The byte-cap fix already landed in this repository's copy, which means the copy has begun diverging from the donor — a reason to make the swap sooner rather than later.

## Taking an issue through

Start with **TRI-23**. After it merges, four tracks open in parallel: TRI-24, TRI-25, TRI-26 (decisions), and TRI-28 (workflow-security tests, independent of everything else).

**TRI-27 is not among them.** It is gated on TRI-67, the donor pin. Do not take that state from this sentence: the native `blocked by` relation in Linear is the authority on whether TRI-67 has cleared, and this document will always lag it. Check the issue.

Once it clears, TRI-27 is the head of the port tier and opens TRI-29, TRI-30, TRI-33, TRI-34, and TRI-44 behind it. The pinned revision to port from is in the Repositories section above.

For each issue:

- **Pick only from `Ready`.** An issue with an unresolved native blocker is not available. The graph has 14 layers with real parallelism inside most of them; prefer breadth over depth so the critical path (TRI-25 → TRI-31 → TRI-35 → TRI-37) keeps moving.
- **Read the issue in full first.** Acceptance criteria are binary by construction and the verification command is named. Several criteria require demonstrating that a guard fails when removed — that is a deliverable, not a formality.
- **Branch from `main`.** Run `git worktree list --porcelain` first: a path other than this repository root may own `refs/heads/main`, in which case do not attach it.
- **Create the named verification script.** Each issue owns one or more uniquely-named scripts and never edits a script another issue owns. Where the issue's own acceptance criteria name a script — every implementation issue does — adding it to the root `package.json` is itself one of those criteria. Do not compose aggregates — TRI-58 owns `test:security`, `test:observability`, and `test:mcp`, and runs last.

  The three decision issues are the exception, by construction rather than by oversight. TRI-24, TRI-25, and TRI-26 each deliver a document and explicitly no code, and their stated verification is `test -f <document>` plus `bun run format:check`. Do not invent a named script for them; there is nothing for it to execute that the file's existence does not already establish, and TRI-58's aggregates compose executable checks, not document-presence assertions. An issue's own acceptance criteria are authoritative where they and this document differ.

- **Drive the pull request to genuinely done**: every review comment resolved (human and bot), CI fully green with every check terminal, and no conflict with `origin/main`, all three verified simultaneously on a fresh fetch. Bot reviews land only after their check completes, so a reading taken right after pushing is worthless.
- **Move the issue to Done yourself**, with completion evidence attached. Stopping at In Review is not finishing. For a `type:release` issue, a merged pull request is never sufficient evidence — the deployed artifact or recorded transcript is.

  "Yourself" means the orchestrator, and only the orchestrator. This is a deliberate, project-scoped override of the `execute-plan` skill's safety boundary, which otherwise says to report a ticket's status and let the user decide. That default is correct in general and still binds every delegated teammate here without exception: a subagent or workflow agent must never transition a ticket. Note that `execute-plan` does carry `mcp__linear__update_issue`, so the boundary is behavioural rather than enforced by tool availability — never read an available tool as permission to use it. The override exists because the Lost Gradient operating rules make picking up a ticket an end-to-end commitment through to Done with completion evidence, and make the primary coordinator the sole Linear writer. `execute-plan` records the same carve-out on its own side so the two cannot drift apart. If you are executing an issue rather than orchestrating the graph, the skill's rule applies to you unchanged: report upward and hand back.

## Verification discipline

This project inherits a codebase whose own recurring failure was **a test suite passing while the fix was entirely absent**. Treat that as the standing review question on every issue: _does this test fail if the fix is reverted?_ Where an issue asks you to demonstrate it, record the failing run in the pull request.

A second inherited failure: **configuration added to a schema but never wired into the gate meant to enforce it**, three separate occurrences. TRI-57 exists to close that structurally. Do not let it degrade into patching known fields.

Check pass or fail by **exit code**, never by grepping output. Tool output carries ANSI escapes, so a pattern like `grep -c "error TS"` can report zero against output that plainly contains errors.

Never use `--no-verify`, `HUSKY=0`, or `CI=1` to get past a hook. Never raise a timeout, retry count, or resource limit to turn a check green.

## Invariants that must survive the port

Each exists because something specific broke in Protokit. Porting the code without the invariant silently regresses it, and none is obvious from reading the code.

- **`SKIP_ENV_VALIDATION` is banned outright** (TRI-44). Bypassing the Zod schema also bypasses its `.default()` values — that produced `undefined` window seconds → `NaN` → the literal string `"NaN"` → Redis's Lua `tonumber` parsing it as a float into `ZREMRANGEBYSCORE`, 500ing every rate-limited route.
- **`NODE_ENV` has no default, and build-time inlining must be checked against the real artifact** (TRI-44). In Protokit, Bun's bundler constant-folded `process.env.NODE_ENV` in dot-access form, so a Dockerfile setting `ENV NODE_ENV=production` in the builder stage welded `"production"` into every shipped bundle and made every fail-closed runtime check vacuous. The bundlers differ here: `applications/web` builds with `svelte-kit sync && vite build`, while `applications/engine` and `applications/proxy` use `bun build --target bun`. Since the MCP server mounts inside `applications/web`, TRI-44 must verify the invariant against the **Vite/SvelteKit production artifact** that actually serves `/mcp`, not against a Bun-bundled one. Do not assume either bundler's inlining behavior; establish it empirically for the artifact under test.
- **Never `z.coerce.boolean()` on a security-relevant flag** (TRI-44). `Boolean("false")` is `true`, so setting a flag to `"false"` silently enabled it.
- **Production refuses `NODE_TLS_REJECT_UNAUTHORIZED=0`** (TRI-44). It defeats every certificate check process-wide.
- **`sslmode=verify-full`, never `require`** (TRI-44). `require` encrypts without verifying the certificate; `verify-ca` skips hostname verification.
- **Logger redaction keeps both halves** (TRI-33). Key-based paths at three nesting depths, plus value-shape scrubbing for secrets interpolated into free-text error messages, which key-based redaction structurally cannot reach.
- **`authenticateMcpUser` ordering is exact** (TRI-43): rebinding check → origin allowlist → rate limit and lockout and concurrency → bounded body → bearer lookup with audience and scope checks strictly last. A request with no `Origin` header at all is allowed by design.
- **One `McpHttpHandler` per authenticated user** (TRI-43). A shared handler leaks `resources/subscribe` events across users.
- **`subscriptions/listen` enforces the same scope check `resources/read` does** (TRI-54). This was a confirmed authorization bypass.
- **The token-passthrough guard stays** (TRI-54). Its value is catching the _next_ tool that adds an unguarded outbound fetch.
- **CIMD SSRF hardening is all-or-nothing** (TRI-42). Blocked ranges for literal-IP _and_ resolved-hostname, rejection if any resolved address is private, `redirect: 'error'`, and HTTPS as an independent second layer against the resolve-then-connect rebinding race.
- **Redirect-URI matching validates fragment and userinfo on both sides** (TRI-37). Validating only the request side was a real defect.
- **Trusted-proxy hop counting** (TRI-50): a header-derived address is trusted only when the immediate peer's socket address is inside a configured CIDR, defaulting to trusting nothing. Empty-position collapse in `X-Forwarded-For` was a confirmed bypass letting a caller choose its own network identity.
- **Every advertised MCP capability is handler-backed** (TRI-29). Protokit once advertised "enterprise authorization" that only checked a static allowlist.
- **The DNS-rebinding check is not gated on conformance mode** (TRI-30). It once was, so it protected only test runs.

Two standing requirements nothing here can pre-satisfy: any tool fetching a user-supplied or client-supplied URL must reuse `assertHostnameIsPubliclyRoutable`; and any tool returning untrusted external content as tool output crosses a prompt-injection boundary Protokit never had to defend. Tribunal reviews arbitrary pull request content, so it crosses that boundary immediately.

## Human checkpoints

This cannot run fully autonomously end to end. Stop and hand back at:

- **TRI-24, TRI-25, TRI-26** — product and architecture decisions. Draft the document with options and a recommendation; do not self-approve.
- **TRI-60** — provisioning production Fly secrets and deploying. Outward-facing and credential-bearing.
- **TRI-62 through TRI-65** — the client release gates. Browser OAuth is unscriptable by design; run the scripted half and hand the manual half back with exact steps.
- **TRI-46** — a Cinder version decision affecting the whole design system, not just this project.

Also stop, rather than working around, if a check fails the same way twice after a fix attempt, an acceptance criterion turns out to be unverifiable as written, or an issue's scope proves materially larger than its description.

## Recommended model and effort

**Orchestrator: Opus, high effort.** It holds a 43-node graph, decides what is next, and judges whether an acceptance criterion is genuinely met. Both inherited failure classes — a passing test with the fix absent, and configuration never wired into its gate — are invisible to pattern-matching. Do not run the orchestrator below Opus.

Per-issue execution, tiered:

- **Opus, xhigh** — the security-critical set: TRI-42 (CIMD SSRF), TRI-44 (environment invariants), TRI-33 (redaction), TRI-54 (passthrough and subscription guards), TRI-57 (startup gate), TRI-50 (trusted proxy), TRI-43 (transport ordering). Subtly wrong here is the entire risk of the project, and each carries a "prove it fails when removed" criterion that rewards a careful verify pass.
- **Opus, high** — the decision issues (TRI-24, TRI-25, TRI-26) and the substantial ports (TRI-27, TRI-37, TRI-38, TRI-40, TRI-41).
- **Sonnet, medium** — the mechanical set: TRI-23, TRI-34, TRI-55, TRI-28, TRI-47, TRI-58.

**Do not fan out widely.** The graph has real parallelism, but most layers are three to six issues and several converge on a single node (TRI-37, TRI-43, TRI-58). Two or three concurrent executors matches its actual width; more will queue on blockers and burn tokens re-reading context.

**Budget the verify passes, not the write passes.** Writing a port is cheap and mostly mechanical. Confirming a guard actually fires, that a test fails when reverted, and that an aggregate script has no dangling reference is where the effort earns its cost.

## Protokit's verification surface

Protokit's own named scripts, for reference when porting a control and wanting to see what proved it there. All are Protokit commands and **none exists in this repository** — each TRI issue creates its own `test:mcp:*` equivalent.

`test:security`, `test:oauth:interop`, `test:conformance:modern`, `test:conformance:legacy`, `test:metadata`, `test:golden-prompts`, `test:rate-limit-concurrency`, `test:multi-replica`, `test:trusted-proxy`, `test:request-boundaries`, `test:resource-exhaustion`, `test:csrf`, `test:authorization-transaction`, `test:private-cache`, `test:browser-security`, `test:operational-endpoints`, `test:error-disclosure`, `test:observability`, `audit:logs`, `test:production-configuration`, `test:development-auth-isolation`, `test:tunnel-boundary`, `test:mcp-load`, `test:graceful-shutdown`, `test:cleanup-scale`, `test:credential-lifecycle`, `test:signing-key-rotation`, `test:connector:codex`, `test:connector:claude-code`, `test:connector:inspector`.

Protokit's full release gate is in its `ROADMAP.local.md`. Treat that file's checkboxes as claims rather than evidence: several were ticked, unticked, and reticked across six hardening waves, and the per-item files under its `.roadmap-progress/` carry the actual verification detail.
