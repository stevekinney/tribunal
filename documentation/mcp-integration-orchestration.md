# Orchestrating the MCP server integration

Standing instructions for the agent driving the MCP server integration. Written to be self-contained: it assumes no memory beyond this repository, its git history, Linear, and this document.

## Mission

Drive the Linear project [Tribunal MCP Server Integration](https://linear.app/lost-gradient/project/tribunal-mcp-server-integration-b7d2b5df1f49) (team `TRI`) to completion: Tribunal's SvelteKit web application serves an authenticated MCP server at `/mcp` with a full OAuth 2.1 authorization server, and Claude Code, Codex CLI, the Claude hosted connector, and ChatGPT developer mode each complete OAuth and invoke a Tribunal tool against the deployed production host.

Linear is the source of truth for what to do. This document is the source of truth for how to do it and what must not be lost along the way.

## Repositories

**Work now spans two repositories, and the label says which.** Issues labeled `repo:tribunal` are executed here. Issues labeled `repo:protokit` are executed in [`stevekinney/protokit`](https://github.com/stevekinney/protokit) and land as pull requests there. Both labels live on the same Linear project, so the whole graph — including its cross-repository blockers — stays in one place. Do not infer the target repository from an issue's body; read its label.

**Protokit is an upstream dependency, not a read-only donor.** This reverses the model the project was originally scoped against, and it is the most important thing on this page.

The original framing was that Protokit is a template to copy from and must never change. That is no longer true. The reusable MCP engine is being **published from Protokit and consumed by this repository as a dependency**, so Protokit now takes pull requests, and work that belongs to the engine belongs upstream rather than here.

The practical test for where a change goes: **does it describe the MCP protocol engine, or does it describe Tribunal?** Engine behaviour — transport, scope enforcement mechanics, tool-response bounds, conformance fixtures — goes upstream. Tribunal's own surface — which tools exist, which scopes they gate, how a user is identified, how the surface is rolled out — stays here.

**Its availability is settled.** TRI-67 chose option (a), pin an immutable revision. Protokit is pinned to `6eb354e43ecc48efdac8abe59daea82dcdab88fd`, reachable on `origin/main`. Read engine source at that revision rather than from the author's working tree, and branch upstream changes from `origin/main` rather than from the pin.

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
- **Embed the whole application** via `createApplicationMount()` (not chosen). This would have made Tribunal a host for Protokit's entire web application, which `EMBEDDING.md` documents as running into three walls: Protokit's application layer has Google identity baked in, its `__Host-` session cookie cannot cross hosts, and migration metadata would need isolating. It also invalidates the locked Neon Auth decision.

The pinned revision above still matters. It is the baseline the published package is cut from, and the reference for reading engine source until a version is on a registry.

**Line references in TRI issue bodies are indicative, not exact.** Locate cited code by symbol name, not line number. Spot-checked at the pinned revision: `packages/mcp/src/env.ts:37-54` is an exact match, landing on the production refusal of `LOG_CONTENT_DIAGNOSTICS_UNTIL` that TRI-44 criterion 8 describes; `applications/web/src/routes/oauth-routes.ts:1204` lands inside `revokeOauthRefreshTokenFamily`, the right subject for TRI-38's refresh and revoke work; `applications/web/src/lib/production-startup-requirements.ts:462-469` lands on the Google credential production requirement, inside TRI-57's module though on content this project deletes by decision. One does not resolve: `applications/web/src/env.ts:37-54` now lands on Railway replica-identifier resolution, because `6eb354e4` rewrote 123 lines of that file.

An instruction that reads "delete `google-id-token.ts`" means _do not bring it across_, not _remove it from Protokit_. Tribunal's identity decision is not a reason to change Protokit's.

## Decisions already made, not to be relitigated

- **Hosting**: `applications/web/src/hooks.server.ts` mounts **Tribunal's own** MCP and OAuth routes, built on the published engine. No new Fly app, Dockerfile, or `fly.toml`. The standalone-service alternative was rejected because the consent screen needs a logged-in user and a separate service cannot read this application's session cookie.

  This supersedes the original wording, which said to mount Protokit's `createApplicationMount()`. That seam mounts Protokit's entire web application, which is the grain of option (c) that was **not** chosen — it carries Protokit's Google identity layer and its own session model, both of which this project's locked decisions replace. Use the engine's exports; do not mount Protokit's application.

  `documentation/mcp-consent-session.md` and `documentation/mcp-rollout.md` were written against the superseded wording and named `createApplicationMount()` as the thing being mounted. Both are corrected to name Tribunal's own handle instead. The requirements they attach to that mount — above all the `sequence()` ordering rule — are unchanged and still binding, because they constrain where in the chain the mount sits, not what supplies it.

- **Identity**: Neon Auth with GitHub as provider is the sole source. Protokit's Google layer is deleted, not adapted. Reuse `applications/web/src/lib/server/auth/neon-session.ts`; do not port a second JWT validator.
- **Clients**: all four. This is why the stateless legacy `2025-11-25` protocol lane, CIMD, dynamic client registration, and the ChatGPT connector assets are in scope.
- **Test runner**: vitest. No `bun:test` enters this repository, enforced by lint rule in TRI-34.

Three further decisions were open when this document was written and have since been made and approved by the user, each recorded as completion evidence on its issue: the scope vocabulary (TRI-24, merged as `fa440112`), the consent-flow session binding (TRI-25, `b11c647e`), and the rollout flag, rollback trigger, and alerting (TRI-26, `50e1b799`). Their committed documents — `documentation/mcp-scopes.md`, `documentation/mcp-consent-session.md`, and `documentation/mcp-rollout.md` — are inputs to the implementation tier and belong on this list rather than in a queue. Do not guess against them and do not reopen them.

Approved does not mean every question inside them is closed. Each carries named items deferred to a later issue — `documentation/mcp-rollout.md` keeps a "Summary of open questions for the approver", and `documentation/mcp-consent-session.md` leaves the refresh-stable session claim to TRI-31. Those are deferred deliberately, with an owner; they are not the decision reopening.

## What the dependency model changes in the graph

The graph was authored as a fork: TRI-27 copies the engine, and TRI-32 through TRI-40 rebuild identity, OAuth endpoints, and the consent screen. Most of that survives unchanged, because Tribunal's application layer is Tribunal's either way. What moves is the engine-level work.

**Read this as analysis, not as settled scope.** Each issue below still needs its own description updated before anyone picks it up; this section says which ones and why, so the next reader is not misled by an issue body written against the fork model.

**Already done, now a bridge, and TRI-80 owns retiring it.** TRI-27 shipped `@tribunal/mcp` as a copy of the engine. That package is temporary: **TRI-80** deletes it, adds the published engine as a pinned dependency, and repoints every consumer. Without that issue the graph could run to completion without ever performing the adoption this document declares, so treat TRI-80 as the node that makes the model change real rather than as cleanup. It is blocked by TRI-72, TRI-73, and TRI-74, and by TRI-78 for the reason in the next section. The copy is not wasted — it proved the engine has zero database or web coupling, which is what makes publishing viable, and its 31 substantively-changed files are the requirements list for what the published package must abstract (runtime-agnostic environment handling, no `bun:test`, a version that survives bundling, an injectable logger).

**The engine cannot be consumed as a library today, and two issues fix that.** This is the hard blocker on everything that defines Tribunal's own surface, and it is not a matter of polish. `createMcpServer` resolves its primitives through static module imports of `allTools`, `allResources`, and `allPrompts`, so a consumer has no way to supply its own; **TRI-72** adds registry injection. `McpScope` is a closed union of Protokit's three demo scopes (`profile:read`, `audit:read`, `prompts:read`) and every operation's `requiredScope` is typed against it, so the five-scope vocabulary `documentation/mcp-scopes.md` settles cannot be expressed without either modifying the upstream package or bypassing its type and validation guarantees; **TRI-73** makes the vocabulary consumer-supplied. Until both are released, TRI-29 does not compile against the engine and no issue downstream of it can start.

**Splits, rather than moving wholesale.** Both issues here read as "moves upstream" at first glance, and both are really a split — the engine half goes up, the adoption half stays. Getting this wrong in either direction wastes work: re-testing the engine here, or assuming someone upstream owns Tribunal's answer.

TRI-30 keeps the half that is genuinely Tribunal's. Conformance fixtures, loopback binding, and the not-gated-on-conformance-mode rebinding check prove the _engine_ speaks the protocol, and those moved to **TRI-77**. What remains under TRI-30 is pointing that harness at Tribunal's own registry and scope vocabulary across both protocol lanes, and registering `test:mcp:conformance` — an answer about Tribunal's tools, not about the engine's fixtures. It stays `repo:tribunal`, blocked by TRI-77 and TRI-80.

TRI-33 does not move at all, and was retitled from "Port" to "Implement" to say so: the redaction policy is Tribunal's own requirement wherever the engine lives. What the dependency model changes is that the engine now owns its own `pino` instance, so engine log lines bypass Tribunal's policy entirely — the same gap criterion 2 exists to close, arriving through a different door. **TRI-76** (host-supplied logger) is the fix, and Tribunal then supplies a logger that already redacts. Note the sequencing: criteria 1 through 4 and 6 can be built against Tribunal's own logger before TRI-76 lands, and only engine-line coverage waits.

**Shrinks.** TRI-34 loses most of its scope: with no ported suites in this repository, there is nothing to convert from `bun:test`, and what remains is the lint rule that keeps `bun:test` out. TRI-44 splits: the MCP environment module belongs to the published package, while Tribunal's own web-surface invariants (`SKIP_ENV_VALIDATION`, `NODE_ENV` inlining against the Vite artifact, `sslmode=verify-full`, the coercion ban) stay here and remain the more important half.

**Unchanged.** Everything describing Tribunal's own surface: TRI-29 (which tools and resources exist), TRI-31 and TRI-35 through TRI-43 (the OAuth server and its mount), TRI-45 through TRI-61 (operations), and the four client release gates.

**The three decisions stand; three fork-era sentences inside them do not.** Scopes, session binding, and rollout are Tribunal's regardless of where the engine lives, and no decision any of those documents reaches is reopened here. What is corrected is narrower and mechanical: `mcp-consent-session.md` and `mcp-rollout.md` instructed implementers to mount `createApplicationMount()`, and `mcp-scopes.md` described the scope mechanism as ported rather than consumed. Left as written, each would have directed an implementer to build the seam this change rejects. Every citation of Protokit at the pinned revision stays exactly as it is — those record what was read, and remain true.

## Working upstream

Protokit has no owning Linear team. Rather than split the graph across two trackers, engine work is filed on **this same Linear project** under the `repo:protokit` label, and mirrored upstream where it needs to be visible to Protokit — [`stevekinney/protokit#33`](https://github.com/stevekinney/protokit/issues/33) mirrors TRI-74. Linear holds the dependency graph; the GitHub issue holds the upstream-facing conversation. Where they disagree, Linear is authoritative.

The upstream set today is TRI-72 through TRI-79, TRI-81, and TRI-82. Do not take that list as current — filter the project by the label.

Three consequences worth stating before the first upstream change:

- **Cross-repository blockers are native `blocked by` relations, because both sides live in Linear.** Use them; do not settle for a prose mention. TRI-80 is the worked example: it is natively blocked by TRI-72, TRI-73, TRI-74, and TRI-78.
- **A released version is the bar, not a merged pull request.** A Tribunal issue blocked on upstream work stays out of `Ready` until the upstream change is on a registry. Merging upstream moves nothing here.
- **A `repo:protokit` issue's delivery boundary, unless its own body says otherwise, is a merged pull request in `stevekinney/protokit`** — except a `type:release` issue, whose boundary is a published version. Stated here once rather than restated on each issue, because none of them carries the section and adding it to each would drift. Note the asymmetry this creates and do not let it confuse you: an upstream issue can legitimately be Done on a merge while every Tribunal issue behind it stays blocked, because the two are measuring different things.
- **Do not let a downstream issue infer capability from an upstream issue being closed.** The bar above tells you when to stop waiting; it does not tell you what you got. TRI-80 is the worked example — its criterion 6 verifies registry injection and the consumer scope vocabulary against the _installed package_, so a version published early for pipeline shakeout cannot satisfy it no matter how its upstream issues resolved their own completion semantics.

- **Something has to own publishing the capability-complete version, and detection is not ownership.** The two rules above combine into a trap worth stating explicitly, because each is individually reasonable. TRI-74 may publish early for pipeline shakeout; TRI-72 and TRI-73 are Done when their pull requests merge. Every one of TRI-80's native blockers can therefore resolve while the registry still holds only the pre-capability build — at which point TRI-80's criterion 6 correctly refuses to pass, and **no `type:release` issue is left owning the publication that would fix it.** Detection without a remedy is a deadlock, not a safeguard. **TRI-74 therefore stays open until the registry holds a version containing every upstream change TRI-80 requires**, however many versions it published on the way there.

State it that way rather than enumerating, because enumerating is how this gets fixed two-thirds of the way. It was first written as "capability-complete", meaning TRI-72 and TRI-73 — which left TRI-78 out, and TRI-78 carries the same released-artifact requirement for exactly the same reason: its byte-cap fix must be in the version Tribunal installs, or the swap silently regresses a security bound. Any upstream change TRI-80's criteria name inherits this rule, including ones filed after this was written.

- **A released version is also not sufficient on its own — it must be the right one.** A version cut before registry injection (TRI-72) and the consumer scope vocabulary (TRI-73) is not adoptable, because Tribunal cannot supply its own tools or its own scopes to it.

**Two findings from the port apply upstream too, and both are filed — but they are different kinds of thing.**

**TRI-78 is a defect.** The tool-result cap measures UTF-16 code units rather than UTF-8 bytes, so the bound it enforces is not the bound it documents. Nothing needs deciding.

**TRI-79 is an open decision, not a defect**, and must not be implemented as though the answer were settled. A present-but-unparseable `Origin` is currently treated as absent, and absent `Origin` is allowed by design — see the `authenticateMcpUser` invariant below. Whether an unparseable value should instead be rejected is a real question with a real argument on each side, and it is a `type:decision` issue for that reason. Draft the options; do not self-approve, and do not carry "unparseable is a defect" into upstream implementation before the decision is made.

TRI-78 is the one that constrains sequencing, and in the opposite direction from what "the copy has diverged, so swap sooner" suggests on its own. The byte-cap fix landed in this repository's copy and not upstream. Adopting a published version cut from the pinned baseline would therefore **delete a security-relevant bound that is present today** and restore the UTF-16 behaviour, and it would do so silently — the swap looks like a dependency bump. So the fix and its test must be upstream and in the exact released version Tribunal consumes. That is why TRI-78 natively blocks TRI-80, and why TRI-80 carries it as an acceptance criterion rather than trusting the ordering to hold.

Divergence remains a reason to swap promptly. It is not a reason to swap onto a version that regresses the thing that diverged.

## Taking an issue through

**Do not take issue state from this document.** Linear's status field and its native `blocked by` relations are the authority, and this page will always lag them. What follows is the shape of the graph, not a report of where it stands: read the project before picking anything up.

The opening tier — the instruction-file correction, the three decision documents, the workflow-security tests, and the bridge package — is behind us. The graph now has two fronts, and they are not symmetrical.

**The upstream front is the critical one, and it gates more than it looks like it does.** TRI-72 and TRI-73 are what make the engine consumable at all. Everything that defines Tribunal's own tools, resources, prompts, or scopes sits behind them, TRI-29 first. Work them before reaching for anything downstream that looks available; an issue whose body predates the dependency model can read as unblocked while being uncompilable in practice.

**Releasing them upstream is not enough on its own — TRI-80 has to run too.** This is the easiest step in the chain to skip, because "registry injection shipped" sounds like the blocker cleared. It did not. Until TRI-80 swaps the bridge for the published package, this repository is still building against `packages/mcp`, whose `server.ts` resolves `allTools`, `allResources`, and `allPrompts` through static module imports. A released upstream capability does nothing for a consumer still importing the copy that lacks it. So the real chain is **TRI-72 and TRI-73 released → TRI-74 published → TRI-80 swapped → TRI-29**, and TRI-29 is natively blocked by all of them. The alternative — patching the temporary copy so TRI-29 can proceed early — deepens exactly the divergence TRI-80 exists to end.

**The Tribunal front continues along the OAuth path, but it is not engine-independent all the way down.** TRI-31 (schema tables) and TRI-35 (query modules) genuinely need nothing from the engine — start there, and prefer breadth over depth so the chain keeps moving.

**TRI-37 is where that stopped being true, and the graph now says so.** Two of its original seven criteria depend on the registry: criterion 7 (scope-defaulting on an omitted `scope`) and `documentation/mcp-scopes.md`'s requirement that the authorize endpoint reject any scope outside `getSupportedScopes()` as `invalid_scope`. That function derives its answer by walking the production registries, and the same document forbids hand-maintaining a parallel list — which is the only way to satisfy those two criteria before TRI-29 exists. Against today's bridge, an implementer would be validating Tribunal's scopes against Protokit's demo registries or against empty arrays.

The other five criteria — the authorization transaction and its single-consume race, RFC 9207 `iss` on error redirects, both-sides redirect-URI matching, `Sec-Fetch-Site` and `Origin` checks before body parsing, CSRF binding — are the security-critical bulk and need nothing from the engine.

**Decided: split, not block.** The project owner chose this on 2026-08-27. Blocking TRI-37 on TRI-29 would have serialized **TRI-38, TRI-39, TRI-40, and TRI-41** behind upstream Protokit work for no gain, since none of the four needs anything from the engine.

Be precise about what the split does not buy: **TRI-58 stays behind the engine work either way**, because TRI-85 blocks it. That is correct rather than a gap — TRI-58 composes the aggregate scripts and must run last, so it cannot precede the scope validation it aggregates. The four issues above are the whole of the scheduling benefit.

**TRI-85** now owns the two scope-dependent criteria — the `invalid_scope` rejection and scope-defaulting — blocked by TRI-37 and TRI-29. TRI-37 keeps criteria 1 through 6 and is **not** blocked on anything upstream.

The split opens a window worth naming, because it is the kind that gets forgotten. Between TRI-37 merging and TRI-85 landing, `/oauth/authorize` exists with no scope validation. That is safe only because `MCP_ENABLED` defaults to `false` and TRI-26's pre-enable gates keep it there, and it is kept safe structurally rather than by memory: **TRI-85 natively blocks TRI-58, which blocks TRI-60 and through it every client release gate**, so the surface cannot reach a production enable while TRI-85 is open. Do not flip `MCP_ENABLED` to `true` in **production or any publicly reachable deployment** before TRI-85 lands, and do not hand-maintain a scope list to close the gap early — `documentation/mcp-scopes.md` forbids a parallel list, which is the whole reason the criteria could not stay in TRI-37.

Isolated local and CI runs are explicitly permitted, and the prohibition would be wrong without that carve-out: TRI-41's own verification has to exercise the enabled state, and a rule forbidding that everywhere would either serialize TRI-41 behind the engine work this split exists to avoid, or teach implementers to ignore a safety instruction because it blocks their assigned task. A safety rule that cannot be followed gets routed around, which is worse than a narrower one that holds.

For each issue:

- **Pick only from `Ready`.** An issue with an unresolved native blocker is not available. Note the extra bar an upstream blocker carries: `Ready` requires the blocking version _released_, not merged.
- **Read the issue in full first.** Acceptance criteria are binary by construction and the verification command is named. Several criteria require demonstrating that a guard fails when removed — that is a deliverable, not a formality.
- **Branch from `main`, in the repository the label names.** Run `git worktree list --porcelain` first: a path other than the repository root may own `refs/heads/main`, in which case do not attach it. A `repo:protokit` issue branches from Protokit's `origin/main`, not from the pinned revision — the pin is a read reference, not a base.
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
- **The DNS-rebinding check is not gated on conformance mode** (**TRI-77**, upstream — it is engine behaviour, and moved there with the rest of the conformance harness; it is TRI-77's criterion 5 verbatim). It once was gated, so it protected only test runs. Listed here rather than dropped because this list is what survives the move: an invariant that leaves this repository still has to hold, and the released version Tribunal consumes is where it gets verified.

Two standing requirements nothing here can pre-satisfy: any tool fetching a user-supplied or client-supplied URL must reuse `assertHostnameIsPubliclyRoutable`; and any tool returning untrusted external content as tool output crosses a prompt-injection boundary Protokit never had to defend. Tribunal reviews arbitrary pull request content, so it crosses that boundary immediately.

## Human checkpoints

This cannot run fully autonomously end to end. Stop and hand back at:

- **Any `type:decision` issue** — product and architecture calls. Draft the document with options and a recommendation; do not self-approve. TRI-24, TRI-25, TRI-26, and TRI-83 have cleared this gate. TRI-79 (whether a present-but-unparseable `Origin` is rejected) has not.

  **TRI-83 is worth reaching for early rather than when its blockers clear.** TRI-43, TRI-52, and TRI-56 are each being built against an answer nobody has stated, and the cost of discovering it late is rework in the three places hardest to retrofit.

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
