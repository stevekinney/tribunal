# Orchestrating the MCP server integration

Standing instructions for the agent driving the MCP server integration. Written to be self-contained: it assumes no memory beyond this repository, its git history, Linear, and this document.

## Mission

Drive the Linear project [Tribunal MCP Server Integration](https://linear.app/lost-gradient/project/tribunal-mcp-server-integration-b7d2b5df1f49) (team `TRI`, 43 issues, TRI-23 through TRI-65) to completion: Tribunal's SvelteKit web application serves an authenticated MCP server at `/mcp` with a full OAuth 2.1 authorization server, and Claude Code, Codex CLI, the Claude hosted connector, and ChatGPT developer mode each complete OAuth and invoke a Tribunal tool against the deployed production host.

Linear is the source of truth for what to do. This document is the source of truth for how to do it and what must not be lost along the way.

## Repositories

**This repository is where all work happens.** Every one of the 43 issues is labeled `repo:tribunal`.

**`~/Developer/protokit` is a read-only donor.** It is a standalone Bun MCP server template whose MCP and OAuth implementation is being copied into this repository. It does not change: never commit to it, never open a pull request against it. It carries uncommitted local modifications that predate this work and are not yours to resolve. Add it to the session as an additional read-only directory.

A `repo:protokit` label exists in Linear and is applied to nothing. If that ever changes, note that Protokit has no owning Linear team and routing must be decided first.

An instruction that reads "delete `google-id-token.ts`" means _do not bring it across_, not _remove it from Protokit_.

## Decisions already made, not to be relitigated

- **Hosting**: mount Protokit's `createApplicationMount()` inside `applications/web/src/hooks.server.ts`. No new Fly app, Dockerfile, or `fly.toml`. The standalone-service alternative was rejected because the consent screen needs a logged-in user and a separate service cannot read this application's session cookie.
- **Identity**: Neon Auth with GitHub as provider is the sole source. Protokit's Google layer is deleted, not adapted. Reuse `applications/web/src/lib/server/auth/neon-session.ts`; do not port a second JWT validator.
- **Clients**: all four. This is why the stateless legacy `2025-11-25` protocol lane, CIMD, dynamic client registration, and the ChatGPT connector assets are in scope.
- **Test runner**: vitest. No `bun:test` enters this repository, enforced by lint rule in TRI-34.

Three decisions remain open and are tracked as issues: the scope vocabulary (TRI-24), the consent-flow session binding (TRI-25), and the rollout flag, rollback trigger, and alerting (TRI-26). Their outputs are inputs to the implementation tier. Do not guess them; drive each to a committed decision document.

## Taking an issue through

Start with **TRI-23**. After it merges, five tracks open in parallel: TRI-24, TRI-25, TRI-26 (decisions), TRI-27 (the `@tribunal/mcp` package port), and TRI-28 (workflow-security tests, independent of everything else).

For each issue:

- **Pick only from `Ready`.** An issue with an unresolved native blocker is not available. The graph has 14 layers with real parallelism inside most of them; prefer breadth over depth so the critical path (TRI-25 → TRI-31 → TRI-35 → TRI-37) keeps moving.
- **Read the issue in full first.** Acceptance criteria are binary by construction and the verification command is named. Several criteria require demonstrating that a guard fails when removed — that is a deliverable, not a formality.
- **Branch from `main`.** Run `git worktree list --porcelain` first: a path other than this repository root may own `refs/heads/main`, in which case do not attach it.
- **Create the named verification script.** Each issue owns one or more uniquely-named scripts and never edits a script another issue owns. Adding it to the root `package.json` is an explicit acceptance criterion. Do not compose aggregates — TRI-58 owns `test:security`, `test:observability`, and `test:mcp`, and runs last.
- **Drive the pull request to genuinely done**: every review comment resolved (human and bot), CI fully green with every check terminal, and no conflict with `origin/main`, all three verified simultaneously on a fresh fetch. Bot reviews land only after their check completes, so a reading taken right after pushing is worthless.
- **Move the issue to Done yourself**, with completion evidence attached. Stopping at In Review is not finishing. For a `type:release` issue, a merged pull request is never sufficient evidence — the deployed artifact or recorded transcript is.

## Verification discipline

This project inherits a codebase whose own recurring failure was **a test suite passing while the fix was entirely absent**. Treat that as the standing review question on every issue: _does this test fail if the fix is reverted?_ Where an issue asks you to demonstrate it, record the failing run in the pull request.

A second inherited failure: **configuration added to a schema but never wired into the gate meant to enforce it**, three separate occurrences. TRI-57 exists to close that structurally. Do not let it degrade into patching known fields.

Check pass or fail by **exit code**, never by grepping output. Tool output carries ANSI escapes, so a pattern like `grep -c "error TS"` can report zero against output that plainly contains errors.

Never use `--no-verify`, `HUSKY=0`, or `CI=1` to get past a hook. Never raise a timeout, retry count, or resource limit to turn a check green.

## Invariants that must survive the port

Each exists because something specific broke in Protokit. Porting the code without the invariant silently regresses it, and none is obvious from reading the code.

- **`SKIP_ENV_VALIDATION` is banned outright** (TRI-44). Bypassing the Zod schema also bypasses its `.default()` values — that produced `undefined` window seconds → `NaN` → the literal string `"NaN"` → Redis's Lua `tonumber` parsing it as a float into `ZREMRANGEBYSCORE`, 500ing every rate-limited route.
- **`NODE_ENV` has no default and is read in bracket-literal form** (TRI-44). Bun's bundler constant-folds `process.env.NODE_ENV` in dot-access form at build time. A Dockerfile setting `ENV NODE_ENV=production` in the builder stage welded `"production"` into every shipped bundle, making every fail-closed runtime check vacuous. This repository builds with `bun build --target bun`.
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
