# Tribunal MCP scope vocabulary

Status: approved—TRI-24 (Graph ID D1), merged as [#322](https://github.com/stevekinney/tribunal/pull/322) and squashed to `fa440112`. The human checkpoint this issue required was cleared by the user; the approval is recorded as completion evidence on TRI-24. Blocks F2, O1, O2, O4.

One item is deliberately carried forward rather than closed: the grant-everything default on an omitted `scope` rests on an assumption about client behaviour that TRI-62 through TRI-65 are where it gets confirmed, and the section below says it should be revisited rather than inherited if clients turn out to send explicit scopes.

Delivery boundary for this issue is documentation only—no code. Every scope, tool, resource, and prompt name below that does not already exist in this repository is a proposal for the implementation tier (F2, O1, O2, O4) to build against, not a claim that it exists yet.

## What this document is not

Tribunal already has a scoped-permission mechanism: `ProxyPermission` (`packages/review-core/src/capability-token.ts`), the `github:read` / `anthropic:invoke` claims minted onto short-lived capability tokens that let a reviewer sandbox call the proxy during a review run. That mechanism is unrelated to this one. This document defines the OAuth scopes a _human user_ grants to an _MCP client_ (Claude Code, Codex CLI, the Claude hosted connector, ChatGPT developer mode) so that client can call Tribunal's MCP tools on the user's behalf. The two never share a token, a claim shape, or a trust boundary—do not conflate a reviewer sandbox's egress permission with an MCP client's OAuth scope.

## Mechanism, inherited unchanged from Protokit

The mechanism is not an open decision—only the vocabulary is. Protokit ([`stevekinney/protokit`](https://github.com/stevekinney/protokit) at the pinned revision `6eb354e43ecc48efdac8abe59daea82dcdab88fd`) establishes three properties this must preserve:

> [!IMPORTANT] The mechanism arrives as a dependency, and it does not yet accept this vocabulary
> This document was drafted when the engine was to be forked, so it reads as a port. Under the dependency model in `documentation/mcp-integration-orchestration.md` the mechanism is consumed from the published engine rather than copied, which changes nothing below—the three properties are the engine's behaviour either way—but it does add a prerequisite. The engine's `McpScope` is today a closed union of Protokit's own three scopes, and every operation's `requiredScope` is typed against it, so the five-scope vocabulary this document settles cannot be expressed without modifying the package or bypassing its type and validation guarantees. **TRI-73** makes the vocabulary consumer-supplied and is a hard blocker on implementing anything here.

Every tool, resource, and prompt declares exactly one `requiredScope` from a closed, hand-authored vocabulary (`packages/mcp/src/scopes.ts` in the donor). There is no generic all-access scope.

`getSupportedScopes()` (`packages/mcp/src/supported-scopes.ts` in the donor) derives `scopes_supported` mechanically by walking the _production_ tool/resource/prompt registries and collecting each entry's `requiredScope` into a sorted, deduplicated set. It never hand-maintains a parallel list, which is what keeps authorization-server metadata and protected-resource metadata publishing the same set everywhere it is called from. It also structurally excludes any scope that only conformance-only fixtures declare, because those fixtures are never in the production registries it walks.

Under-scoped calls are rejected at invocation—`tools/call`, `resources/read`, and `prompts/get` each check the caller's granted scopes against the target's `requiredScope` and return an error carrying a `WWW-Authenticate`-shaped challenge—never by filtering the tool out of `tools/list`. The donor's challenge shape, verbatim:

```
Bearer error="insufficient_scope", scope="<required>"
```

A client always sees every tool exists; it discovers which ones it cannot call by trying.

**`packages/mcp` does exist in this repository now, and it is not where this vocabulary goes.** TRI-27 landed it as a copy of Protokit's engine, carrying Protokit's own `scopes.ts` and `supported-scopes.ts` with Protokit's three demo scopes. That package is a **bridge**: TRI-80 deletes it and replaces it with the published engine. An earlier revision of this document said the package did not exist, which invited exactly the wrong move — adding Tribunal's scopes to the temporary copy, deepening the divergence TRI-80 exists to end, and building against a closed `McpScope` union rather than waiting for TRI-73 to open it.

What the implementation tier owns is Tribunal's **injected** registry and vocabulary, supplied to the published engine — F2 (TRI-29) defines the registry, O1 (TRI-37) consumes the derived scope set at authorize time. This document fixes what goes in those, not what goes in the bridge.

## Tribunal's actual capability surface

Surveyed against `documentation/ARCHITECTURE.md` and the packages it names, constrained to the first release's read-only mandate—no write-capable MCP tool is in scope for this vocabulary, full stop:

Repository identity lives in `packages/database/src/schema/repository.ts`—GitHub repo id, owner, name, default branch, latest commit.

**The read path is not self-gating, and any tool built on it must add the check itself.** `getRepositoryById` (`packages/github/src/repositories/service.ts`) takes only a repository id and performs an unscoped `select().from(repository).where(eq(repository.id, ...))`. There is no user parameter and no installation filter. `getOrCreateRepository` is an unscoped upsert, not a read at all. Tribunal's own web routes are safe because they call `userCanAccessRepository(user.id, repositoryId)` _separately_ before exposing the row.

An MCP tool that follows the reader without that separate call lets any authenticated token enumerate another user's repository metadata by guessing ids. **Requirement for F2/O1: every `repositories:read` tool must call `userCanAccessRepository` (or an equivalent installation-scoped read) before returning anything.** Naming this here because the function names alone read as though the gate were built in; it is not.

Pull request _content_ is never stored (`documentation/ARCHITECTURE.md`, Data Model section)—bodies, diffs, comments, and list or detail responses are fetched live from the GitHub API through `packages/github/src/pull-requests/service.ts` (`listPullRequests`, `getPullRequest`, `getPullRequestOperationalStatus`). Content here is entirely author-controlled: title, description, diff, and comments come from whoever opened the pull request, not from Tribunal or the requesting user.

**Operational pull request state _is_ persisted, though, and F2/O1 should not treat this family as wholly live.** `packages/database/src/schema/pull-request-state.ts` defines a `pull_request_state` table holding the pull request number, open or closed state, draft flag, head and base identifiers, and CI, review, and merge status, keyed uniquely on repository and pull request number.

**That table also carries Tribunal-internal automation state, and `pull_requests:read` does not grant it.** `automationStatus`, `attemptCount`, `lastErrorMessage`, `lastTriggerSignature`, `signatureAttemptCount`, `lastAttemptAt`, and `isPaused` describe Tribunal's own workflow and operator decisions, not GitHub pull request content — which is what this scope's consent text tells the user they are approving. A projection built from the whole row would disclose internal error strings and pause state under a grant that never mentioned them. **Requirement for F2/O1: restrict the projection to the pull request, CI, review, and merge fields.** If a later issue wants the automation fields exposed, they need their own scope with their own disclosed consent text. Engine and GitHub state modules read and update those rows in production. That projection has different access, freshness, and caching characteristics from a live GitHub read, and a tool answering "what is the state of this pull request" may well want the stored row rather than an API call.

**Two of the four things this scope's consent text promises have no reader today.** `getPullRequest` returns the pull request body plus numeric `comments` and `reviewComments` _counts_; `listPullRequests` and `getPullRequestOperationalStatus` likewise return neither diffs nor comment bodies. Diff data currently reaches the system through the review diff-context service, and comment content needs a separate GitHub read that does not exist as a reusable service function.

So a `pull_requests:read` tool built against the cited path cannot deliver the diffs and comments the consent screen says the user is granting. **F2/O1 must either build those readers—with their own API, permission, rate-limit, and caching characteristics, none of which the existing functions carry—or narrow the consent string to what is actually retrievable.** Recorded rather than left for the implementer to discover after the consent copy is already shipped.

**The repository authorization requirement stated above applies to every pull request primitive too, and this is a separate hole rather than a restatement.** `getInstallationForRepository` takes a repository id and no user id; `listPullRequests`, `getPullRequest`, and `getPullRequestOperationalStatus` take an Octokit client plus owner and repo strings, and none takes a user id either. Tribunal's own pull request route is safe because it calls `userCanAccessRepository` _before_ resolving the installation. A `pull_requests:read` tool that resolves an installation from a caller-supplied repository id, without that check first, lets any scope-bearing user read private pull request content from a repository connected by somebody else — a worse outcome than the metadata enumeration the repositories section describes, because the content is the point of the scope.

**Requirement: authorize the repository before resolving its installation, for every pull request primitive.**

Review runs are `tribunal_run` rows (`packages/database/src/schema/tribunal-run.ts`) with a `pull_request_review_run` child detail table—status, workflow id, sandbox id, cost estimate, start/finish timestamps. This is Tribunal's own system-generated lifecycle metadata.

**But `getRunInspector` is not a lifecycle-only read, and reusing it wholesale would collapse this scope into the next one.** It queries agent descriptions and agent events alongside run rows (`applications/web/src/lib/server/review/operator.ts`), returning that content inside each agent run.

**Those fields are not findings, and they are not covered by any scope in this vocabulary.** An earlier revision described them as material reserved for `review_findings:read`; that was wrong. `agent_event.detail` and snapshotted agent descriptions are execution and configuration telemetry, while `review_findings:read`'s consent text and table row authorize finding rows and nothing else. Agents are explicitly named below as _not_ exposed under any first-release scope. So a findings-only token receiving them would be getting data no scope grants — a worse outcome than the scope-collapse the earlier wording described.

**Requirement for F2/O1: omit agent descriptions and agent events entirely**, rather than routing them to a different scope. Exposing them at all is a new-scope decision with its own consent text, not a projection detail.

**Requirement for F2/O1: a `reviews:read` tool must use a lifecycle-only projection, or strip the separately scoped fields before returning.** `getRunsOverview` is the closer fit, **but it is not a drop-in either: it ends in an unconditional `.limit(50)` and accepts no cursor or page parameter.** An MCP `list_review_runs` built directly on it would silently omit every run beyond the most recent fifty — the worst failure shape for a list tool, because the client cannot tell truncation from absence.

So F2/O1 owes one of two things, stated rather than left implicit: a lifecycle-only reader that paginates, or an explicit definition of this primitive as recent-history-only, with the cap disclosed in the tool description so a client knows what it is not seeing. `getRunInspector` must not be exposed unmodified in either case.

Findings are `finding` rows (`packages/database/src/schema/finding.ts`) emitted by an `agent_run`—severity, file path, line range, title, body, suggested fix, verification status. Distinct from review-run metadata: a finding's `body` and `suggestion` are free text a reviewer agent wrote _about specific pull request content_, so they can reflect (and, if a reviewer agent was successfully misled, actively repeat) attacker-supplied text from the pull request being reviewed.

Cost events are `cost_event` rows (`packages/database/src/schema/cost-event.ts`)—amount, source, repository, agent, occurred-at—surfaced today through `getCostOverview` on the `/costs` route.

**`getCostOverview` must not be reused as-is: it writes.** It calls `getUserReviewSettings`, whose first operation is an `INSERT ... ON CONFLICT DO NOTHING` that creates a settings row when none exists. That contradicts the first release's read-only mandate outright and would make an MCP read depend on write-capable database access — a privilege the whole point of this vocabulary is to withhold. **Requirement for F2/O1: point cost tools at a pure `cost_event` projection and obtain any defaults without an upsert.** Reusing this function is prohibited, not merely discouraged. `documentation/decisions.md`'s 2026-07-25 entry confirms only the `estimate` source is live; per-run reconciliation against the Anthropic Usage & Cost API was removed (#215) because that endpoint has no run dimension.

That is five capability families with real, distinct data behind them: repositories, pull requests, reviews, review findings, cost events. Nothing else in the schema (agents, webhook events, installation lifecycle, operator settings) is a read a third-party MCP client plausibly needs for a first release, and none of it is proposed as a scope below. If a later issue wants to expose one of those, it is a new scope, not folded silently into an existing one.

## The prompt-injection boundary

Protokit never returned content it did not author or the authenticated user did not author. Tribunal reviews arbitrary pull requests—the pull request body, diff, and comments a `pull_requests:read` tool call returns are written by whoever opened the pull request, who is not the MCP client's user and may be adversarial. Any MCP client that feeds a Tribunal tool's output to its own LLM is exposed to prompt injection the moment it calls a `pull_requests:read`-gated tool, exactly the class of risk `documentation/mcp-integration-orchestration.md` flags in its "Two standing requirements" paragraph.

`review_findings:read` inherits the same exposure at one remove: a finding's `body`/`suggestion` is Tribunal's reviewer agent's own output, but that agent was reading the same adversarial pull request content, so a finding can still repeat or launder injected text if the reviewer agent itself was misled during the review.

`reviews:read` and `cost_events:read` return system-generated values—run lifecycle state, timestamps, dollar amounts—**but the readers this document recommends for them also emit repository labels, and those are externally authored.** `getRunsOverview` returns `repositoryOwner` and `repositoryName`, and `getCostOverview` carries the same values in its rollup labels. Those strings are chosen by repository administrators, exactly as the `repositories:read` discussion below describes.

So these two scopes cross the boundary **whenever their output includes repository labels**, which is the default shape of both readers. Two acceptable resolutions, and F2/O1 must pick one per tool rather than leaving it implicit: strip the labels and return repository ids alone, letting a client that wants names ask for `repositories:read` and accept that scope's framing; or keep the labels and apply the same untrusted-content framing `repositories:read` requires. What is not acceptable is returning administrator-controlled strings under a scope this document told the implementer was safe.

**`repositories:read` does cross it, and an earlier draft of this document was wrong to group it with the other two.** Repository names, owner names, and default-branch names are chosen on GitHub by repository administrators, who in an organization or shared repository need not be the authenticated MCP user. Installation-gating controls _who can read_ the value; it does nothing about _who wrote_ it. A default branch named to read as an instruction is attacker-controlled text arriving through a scope this document had classified as safe.

The exposure is narrower than `pull_requests:read`—short identifier-shaped strings rather than arbitrary prose—but the difference is degree, not kind, and a downstream tool told this scope is non-crossing will omit the untrusted-data framing entirely. Review and cost projections that include repository labels inherit the same exposure.

**Findings readers owe an object-level ownership check, exactly as the repository and pull request readers do.** Holding `review_findings:read` proves the user consented to the _capability_; it proves nothing about whether a caller-supplied run or finding identifier belongs to them. There is no existing findings reader to inherit safety from — the closest safe path, `getRunInspector`, filters on both `finding.userId` and `agentRun.runId`, and any new projection must carry the equivalent. **Requirement for F2/O1: every findings projection enforces the authenticated user's ownership of the row**, or `list_review_findings` and `get_review_finding` become a cross-tenant read.

This is why `pull_requests:read` and `review_findings:read` are kept as their own scopes rather than folded into a broader "reviews" scope: a client that only wants review-run status and cost (`reviews:read`, `cost_events:read`) never has to accept exposure to adversarial content it isn't asking for. Whatever tool implementation lands under F2/O1 for these two scopes should carry an explicit untrusted-content boundary (framing the returned text as data, not instructions, in the tool result)—this document names the requirement; implementing it is out of this issue's delivery boundary.

## Recommended scope vocabulary

Five production scopes, one per capability family, plus one conformance-only scope. Naming follows the donor's `noun:read` shape and this repository's snake_case-for-multi-word-identifiers convention.

| Scope                  | Capability family                         | Gates (illustrative—final names are F2/O1/O2 decisions)        | Crosses the injection boundary             |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `repositories:read`    | Repository identity and access            | `list_repositories`, `get_repository`                          | Yes—administrator-controlled names         |
| `pull_requests:read`   | Live GitHub pull request content          | `list_pull_requests`, `get_pull_request`                       | Yes—author-controlled content              |
| `reviews:read`         | Review run lifecycle and cost estimate    | `list_review_runs`, `get_review_run`                           | Only if repository labels are included     |
| `review_findings:read` | Findings emitted by review runs           | `list_review_findings`, `get_review_finding`                   | Yes—reflects reviewed pull request content |
| `cost_events:read`     | Cost ledger                               | `list_cost_events`, `get_cost_summary`                         | Only if repository labels are included     |
| `conformance:read`     | Conformance-only fixture, never real data | one synthetic fixture tool, name and payload decided by TRI-30 | No—returns synthetic data only             |

The one-line consent-screen description is the verbatim text a `getSupportedScopes()`-equivalent registry must display, matching the donor's `mcpScopeDescriptions` shape (`packages/mcp/src/scopes.ts`) and rendered the same way the donor's authorize page renders it—one `<li>` per granted or requested scope, the string copied through unmodified:

```typescript
export const mcpScopeDescriptions: Record<TribunalMcpScope, string> = {
  'repositories:read':
    "Read the repositories you've connected to Tribunal, including their name, owner, default branch, and latest commit.",
  'pull_requests:read':
    'Read pull request content from your connected repositories, including titles, descriptions, diffs, and comments.',
  'reviews:read':
    "Read the status, timing, and cost estimate of Tribunal's automated reviews in your connected repositories.",
  'review_findings:read':
    "Read the findings Tribunal's review agents reported in your connected repositories, including severity, file location, and suggested fixes.",
  'cost_events:read':
    'Read your Tribunal spending history, including estimated review costs by repository and agent.',
  'conformance:read':
    'Conformance-only. Exercises Tribunal MCP protocol test fixtures and grants no access to your repositories, pull requests, findings, or spending.',
};
```

`conformance:read`'s description is documented here for completeness (AC2 asks for every scope, and the donor gives its own conformance-only scope one too) even though, per the next section, it should never actually render on a live consent screen.

## Conformance-only scope: recommendation

Protokit's `audit:read` gates `list_audit_events`, a synthetic fixture tool registered only when `enableConformanceMode` is on, excluded from `getSupportedScopes()` because that function only walks the production registries. The orchestration document's invariant list (`documentation/mcp-integration-orchestration.md`) preserves the same shape for Tribunal: "the DNS-rebinding check is not gated on conformance mode" (TRI-30) and "every advertised MCP capability is handler-backed" (TRI-29) both presuppose a conformance mode exists, separate from production, that protocol test suites (`test:conformance:modern`, `test:conformance:legacy`, `test:connector:inspector` in the donor's script list) exercise without touching real repositories, pull requests, findings, or cost data.

Recommendation: reserve `conformance:read` as Tribunal's equivalent, gating a to-be-named synthetic fixture tool, excluded from `getSupportedScopes()` by construction (the same "only walk production registries" mechanism, not a second exclusion list to keep in sync), and never obtainable through a real `/oauth/authorize` flow.

**That last property needs an actual check, not just absence from the UI.** The client controls the `scope` value it sends, so omitting `conformance:read` from registrations and the consent screen does not make it unobtainable — and this document's own rule that "an explicit non-empty `scope` list is granted exactly as requested" would otherwise hand it straight to any client that asks for it by name. Not offering something is not the same as refusing it.

**Requirement: the authorize endpoint must reject any requested scope outside `getSupportedScopes()` as `invalid_scope`.** Since `getSupportedScopes()` structurally excludes conformance-only scopes by walking production registries alone, that single rule makes `conformance:read` unobtainable as a consequence of the mechanism rather than a second list to maintain. It also closes the same hole for any future conformance-only scope automatically.

Open question, with a named owner: this document reserves the _scope name and mechanism_; it does not specify what the fixture tool returns. **TRI-30 decides it**, against Tribunal's actual conformance test needs rather than guessed here.

An earlier revision assigned this to "whichever issue ports `conformance-server.ts`", which under the dependency model is nobody — the harness itself moved upstream to TRI-77, and no Tribunal issue ports it. The choice still belongs here, though, because it is a question about what _Tribunal's_ fixture returns behind _Tribunal's_ reserved scope, and TRI-30 is the issue that points the upstream harness at Tribunal's registry. Do not let it follow the harness upstream and go unanswered.

## Omitted `scope` parameter at authorize time: grants every supported scope

When an authorize request omits `scope` entirely, Tribunal's authorization server grants the full supported set—every scope `getSupportedScopes()` returns, `conformance:read` excluded by the same mechanism that excludes it everywhere else. This is the same default Protokit uses, re-decided here on Tribunal's own capability surface rather than carried over by assumption, for four reasons:

MCP clients are expected to omit `scope` on their authorize request. The only evidence for that is the donor's own `applications/web/src/lib/oauth-scope.ts` doc comment, which names three connectors—Claude, Codex, and ChatGPT—as omitting `scope`. That is Protokit's observation about its own client set, it does not separately cover the Claude hosted connector as a fourth client, and Tribunal has not independently confirmed it for any of them. It is the working assumption behind this default, not a verified fact, and the release gates (TRI-62 through TRI-65) are where each client's actual behaviour gets recorded. A default of "grant nothing" would mean any client that omits `scope` receives a token failing every tool call with `insufficient_scope` on day one, with no code path letting it ask for more. A client that does send an explicit `scope` is unaffected either way: an explicit non-empty list is granted exactly as requested and never expanded.

RFC 6749 section 3.3 explicitly permits "process[ing] the request using a pre-defined default value" for an omitted `scope`, so this is a standards-sanctioned choice, not a workaround.

The actual safety control is the consent screen, not the default. Tribunal has no unattended or anonymous MCP access—every authorize request requires a logged-in Neon Auth session, and whatever scope set is in play (default-all or an explicit narrower request) is listed line by line, using the verbatim descriptions above, before the user approves anything. A default of "grant everything" is not a silent escalation; it is what the user is shown and asked to approve.

A narrower default—for example `repositories:read` and `reviews:read` only, withholding `pull_requests:read`, `review_findings:read`, and `cost_events:read` unless explicitly requested—is the real alternative, and an earlier draft argued against it on an inverted premise worth correcting rather than quietly deleting.

The default applies **only** to requests that omit `scope`. A narrower default therefore changes the outcome for exactly the clients that omit it, and leaves clients sending an explicit `scope` untouched. The earlier draft had this backwards, and the consequence of the error is that it dismissed a genuine privilege reduction as though it bought nothing.

Stated correctly, the trade is: **a narrower default is a real reduction in privilege, precisely for the clients this document assumes are the common case.** A client omitting `scope` would receive two scopes rather than five, and would never hold `pull_requests:read`—the one scope carrying arbitrary adversarial content—unless it asked by name. Against that, the cost is interoperability: under the working assumption above, which is confirmed for none of the four clients, three of five scopes would never work for a client that omits `scope` until a further Tribunal-side or client-side change teaches it to ask.

Two corrections to how the earlier draft characterized that cost. The failures would not be silent—a call without the required scope returns the `insufficient_scope` challenge specified at the top of this document, which is a diagnosable error rather than a mystery. And "some tools work and others do not" is the normal condition of any scoped OAuth system, not a pathology unique to a narrow default.

The recommendation still stands on interoperability, but the approver should weigh it knowing the security cost is real rather than nil. **If the release gates find that clients do send explicit scopes, the interoperability argument largely evaporates and this default should be revisited rather than inherited.**

This default applies to the initial `/oauth/authorize` request only. `oauth-scope.ts`'s companion behavior in the donor is a separate, already-settled rule worth carrying forward unchanged: a present-but-empty `scope=` parameter is not the same as an omitted one and must be rejected as `invalid_scope` (RFC 6749's ABNF requires at least one scope-token, so "empty" cannot mean "give me the default"); an explicit non-empty `scope` list is granted exactly as requested, never expanded; and on a refresh-token request, an omitted `scope` means "keep the token's existing granted scope unchanged," not "reapply the default full set."

**One correction to the donor's rule, and it is a real hole rather than a clarification.** "An explicit non-empty `scope` list is granted exactly as requested" is correct at `/oauth/authorize`, where the user is present and approving. Applied unchanged to a refresh request it is a privilege-escalation path: a client that was granted a narrow token could refresh with the full supported set and receive it, bypassing the consent the user actually gave, with no user present to notice.

RFC 6749 section 6 requires the opposite — a refresh request's scope must be no broader than the original grant. **Requirement for TRI-38: on a refresh-token request, an explicit `scope` must be a subset of the scopes the refresh token already carries; anything outside that set is rejected as `invalid_scope`.** Narrowing on refresh is fine and should be allowed. Widening never is, whether requested explicitly or by omission.

## Client display-name rejection test strings

TRI-24's acceptance criteria ask this document to carry the literal set of control-character and bidirectional-text strings a client display name must be rejected for, so O4 (or whichever issue ports the donor's client-name validation) has a concrete fixture list rather than a property to interpret. This is a direct, unmodified port of the donor's `isValidClientName` behavior (`applications/web/src/lib/client-name-validation.ts` in Protokit)—not a new decision.

Every offending code point below is given as a JavaScript-source `\uXXXX` escape sequence, typed as literal backslash-u-hex-digit ASCII text exactly the way the donor's own test source spells it—never as an actual control, bidirectional-override, or zero-width glyph pasted into this file. That mirrors the donor's own stated reason for encoding its pattern source the same way: the set stays reviewable and cannot silently drift if this file is re-encoded, and a real right-to-left override character sitting inside a committed document is itself a trojan-source hazard, not just an inconvenience.

The three rejected character classes, by Unicode range:

- C0 control characters and DEL/C1 control characters: `U+0000` through `U+001F`, and `U+007F` through `U+009F`.
- Bidirectional formatting characters: `U+061C` (Arabic Letter Mark), `U+200E` (LRM), `U+200F` (RLM), `U+202A` through `U+202E` (LRE/RLE/PDF/LRO/RLO), `U+2066` through `U+2069` (LRI/RLI/FSI/PDI).
- Zero-width characters: `U+200B` through `U+200D` (zero-width space/non-joiner/joiner), `U+FEFF` (byte-order mark / zero-width no-break space).

The literal test strings the donor's suite asserts must be rejected, written the same way the donor's test source writes them, so a port can copy them directly into a test file:

- `'My\u0000App'`—embedded NUL byte.
- `'My\nApp'`—embedded newline, a C0 control character.
- `'My\u0085App'`—embedded C1 control character (NEL).
- `'My\u202EApp'`—right-to-left override.
- `'My\u2066App\u2069'`—isolate formatting characters (LRI / PDI).
- `'My\u200EApp'`—bare left-to-right mark.
- `'My\u200BApp'`—zero-width space.
- `'\uFEFFMy App'`—leading byte-order mark.

Two strings the donor's suite asserts must still be _accepted_, so a port does not overcorrect into rejecting ordinary non-Latin names: an ordinary ASCII name (for example `'My App'`), and an ordinary non-Latin name using kanji and katakana only, with no control, bidi, or zero-width code point present—the donor's own fixture is the Japanese string for "Japanese app" (four kanji characters followed by three katakana characters, `日本語アプリ`).

Beyond AC5's literal ask, the donor adds one more check worth naming here even though it is not a control-character or bidirectional-text case: a mixed-script homoglyph check that rejects a name only when it mixes Latin-script letters with Cyrillic or Greek letters in the same name (the donor's own example is a Cyrillic lowercase "a," `а`, standing in for the Latin "a" in the string "PayPal," written as `'PаyPal'`), while still accepting a name written _entirely_ in Cyrillic or entirely in Greek. Whether this repository ports that fourth check is a decision for whichever issue implements client-name validation, not this one—it is named here only so it is not mistaken for part of AC5's control/bidi set.

## Open questions

**Scope cardinality: decided here, one scope per primitive.** An earlier draft left this open while the mechanism section above called single-scope a property the port "must preserve"—a contradiction F2/O1 could not satisfy both halves of, and one that changes both how `getSupportedScopes()` flattens declarations and whether invocation authorization checks one scope or several. Leaving it open was the error, so it is decided rather than restated.

`requiredScope` stays a single `McpScope`, and a genuinely cross-domain primitive—a prompt summarizing a pull request's findings would need both `pull_requests:read` and `review_findings:read`—**must be split into two primitives.** It may not be shipped as one.

An earlier draft offered "or scope it to the more sensitive of the two" as an alternative. That is an authorization bypass, not a shortcut, and removing it is the point of this revision. Nothing in this vocabulary or its consent text establishes a hierarchy in which holding one scope implies the other — they are independently listed, independently approved, and independently refusable. A combined primitive gated on whichever scope someone judged more sensitive would therefore return data governed by a scope the user may have declined, to a token that never carried it.

So the rule is unconditional: **a primitive returns data from exactly one capability family.** If a primitive genuinely cannot be split, that is not licence to pick a scope — it is the signal to reopen the cardinality decision below, with `allOf` semantics requiring _every_ scope whose data the primitive returns.

The reason is that widening it is not a type change. It changes what `scopes_supported` derivation must flatten, and it turns invocation authorization from one comparison into a policy question—all of them, or any of them?—that then has to be answered identically at every enforcement site. That is a larger change than a first release needs for a capability surface containing no such primitive.

If a later issue finds a primitive that genuinely cannot be split, widening `requiredScope` to `McpScope[]` with `allOf` semantics is the reversible path—but as its own decision, with the derivation and enforcement changes in scope, rather than a field type quietly relaxed mid-implementation.

Consent-screen preselection UX: this document decides the token-grant default (omitted `scope` grants the full supported set) but not how the consent screen visually presents that—whether it shows one flat "grant everything" approval or a checkbox per scope with some subset preselected. **TRI-40 decides it**, as the issue that builds the screen, and should read this document's default before making that call rather than re-deriving it.

An earlier revision assigned this to TRI-25, which is now Done and never covered it: TRI-25 scoped itself to how `GET /oauth/authorize` identifies its user and what the authorization transaction binds to, explicitly not the rest of the flow. Leaving it there would have meant either reopening a completed decision or guessing at deselection behaviour mid-implementation. If TRI-40 concludes the choice is larger than a screen-level call—per-scope deselection changes what token gets issued, not just what renders—raise it as its own decision rather than settling it inside the pull request.

Conformance fixture content: named above—reserving the `conformance:read` scope and its exclusion mechanism is this document's job; deciding what the fixture tool actually returns is not.

MCP resources versus tools-only: this document proposes illustrative tool names for every scope and does not commit to whether Tribunal's first release also exposes MCP resources (the donor's `user://profile`-style URI resource, with its `resources/subscribe` surface). The orchestration document's invariant list ("one `McpHttpHandler` per authenticated user," "`subscriptions/listen` enforces the same scope check `resources/read` does") describes constraints on that surface _if_ it is ported, but does not itself decide that Tribunal needs resources in a first release rather than tools alone. That decision, too, belongs to F2/O1.
