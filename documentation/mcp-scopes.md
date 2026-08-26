# Tribunal MCP scope vocabulary

Status: draft, awaiting human approval—TRI-24 (Graph ID D1). This document proposes a decision; it does not self-approve. Blocks F2, O1, O2, O4.

Delivery boundary for this issue is documentation only—no code. Every scope, tool, resource, and prompt name below that does not already exist in this repository is a proposal for the implementation tier (F2, O1, O2, O4) to build against, not a claim that it exists yet.

## What this document is not

Tribunal already has a scoped-permission mechanism: `ProxyPermission` (`packages/review-core/src/capability-token.ts`), the `github:read` / `anthropic:invoke` claims minted onto short-lived capability tokens that let a reviewer sandbox call the proxy during a review run. That mechanism is unrelated to this one. This document defines the OAuth scopes a _human user_ grants to an _MCP client_ (Claude Code, Codex CLI, the Claude hosted connector, ChatGPT developer mode) so that client can call Tribunal's MCP tools on the user's behalf. The two never share a token, a claim shape, or a trust boundary—do not conflate a reviewer sandbox's egress permission with an MCP client's OAuth scope.

## Mechanism, ported unchanged from Protokit

The mechanism is not an open decision—only the vocabulary is. Protokit (pinned donor, `~/Developer/protokit` at `6eb354e4`) establishes three properties this port must preserve:

Every tool, resource, and prompt declares exactly one `requiredScope` from a closed, hand-authored vocabulary (`packages/mcp/src/scopes.ts` in the donor). There is no generic all-access scope.

`getSupportedScopes()` (`packages/mcp/src/supported-scopes.ts` in the donor) derives `scopes_supported` mechanically by walking the _production_ tool/resource/prompt registries and collecting each entry's `requiredScope` into a sorted, deduplicated set. It never hand-maintains a parallel list, which is what keeps authorization-server metadata and protected-resource metadata publishing the same set everywhere it is called from. It also structurally excludes any scope that only conformance-only fixtures declare, because those fixtures are never in the production registries it walks.

Under-scoped calls are rejected at invocation—`tools/call`, `resources/read`, and `prompts/get` each check the caller's granted scopes against the target's `requiredScope` and return an error carrying a `WWW-Authenticate`-shaped challenge (donor: `Bearer error="insufficient_scope", scope="<required>"`)—never by filtering the tool out of `tools/list`. A client always sees every tool exists; it discovers which ones it cannot call by trying.

Tribunal's own `packages/mcp` and its `scopes.ts` / `supported-scopes.ts` equivalents do not exist yet—they are F2/O1 deliverables. This document fixes what goes in them.

## Tribunal's actual capability surface

Surveyed against `documentation/ARCHITECTURE.md` and the packages it names, constrained to the first release's read-only mandate—no write-capable MCP tool is in scope for this vocabulary, full stop:

Repository identity and access lives in `packages/database/src/schema/repository.ts` and is read through `packages/github/src/repositories/service.ts` (`getRepositoryById`, `getOrCreateRepository`, and friends)—GitHub repo id, owner, name, default branch, latest commit, gated by which GitHub App installation the user's account holds.

Pull requests are never stored (`documentation/ARCHITECTURE.md`, Data Model section)—they are fetched live from the GitHub API through `packages/github/src/pull-requests/service.ts` (`listPullRequests`, `getPullRequest`, `getPullRequestOperationalStatus`). This is the one family whose content is entirely author-controlled: title, description, diff, and comments come from whoever opened the pull request, not from Tribunal or the requesting user.

Review runs are `tribunal_run` rows (`packages/database/src/schema/tribunal-run.ts`) with a `pull_request_review_run` child detail table—status, workflow id, sandbox id, cost estimate, start/finish timestamps. This is Tribunal's own system-generated lifecycle metadata, read today through `applications/web/src/lib/server/review/operator.ts`'s `getRunsOverview` and `getRunInspector`.

Findings are `finding` rows (`packages/database/src/schema/finding.ts`) emitted by an `agent_run`—severity, file path, line range, title, body, suggested fix, verification status. Distinct from review-run metadata: a finding's `body` and `suggestion` are free text a reviewer agent wrote _about specific pull request content_, so they can reflect (and, if a reviewer agent was successfully misled, actively repeat) attacker-supplied text from the pull request being reviewed.

Cost events are `cost_event` rows (`packages/database/src/schema/cost-event.ts`)—amount, source, repository, agent, occurred-at—read today through `getCostOverview` on the `/costs` route. `documentation/decisions.md`'s 2026-07-25 entry confirms only the `estimate` source is live; per-run reconciliation against the Anthropic Usage & Cost API was removed (#215) because that endpoint has no run dimension.

That is five capability families with real, distinct data behind them: repositories, pull requests, reviews, review findings, cost events. Nothing else in the schema (agents, webhook events, installation lifecycle, operator settings) is a read a third-party MCP client plausibly needs for a first release, and none of it is proposed as a scope below. If a later issue wants to expose one of those, it is a new scope, not folded silently into an existing one.

## The prompt-injection boundary

Protokit never returned content it did not author or the authenticated user did not author. Tribunal reviews arbitrary pull requests—the pull request body, diff, and comments a `pull_requests:read` tool call returns are written by whoever opened the pull request, who is not the MCP client's user and may be adversarial. Any MCP client that feeds a Tribunal tool's output to its own LLM is exposed to prompt injection the moment it calls a `pull_requests:read`-gated tool, exactly the class of risk `documentation/mcp-integration-orchestration.md` flags in its "Two standing requirements" paragraph.

`review_findings:read` inherits the same exposure at one remove: a finding's `body`/`suggestion` is Tribunal's reviewer agent's own output, but that agent was reading the same adversarial pull request content, so a finding can still repeat or launder injected text if the reviewer agent itself was misled during the review.

`repositories:read`, `reviews:read`, and `cost_events:read` return only system-generated or installation-gated metadata—repository identity, run lifecycle state, dollar amounts—none of it pull-request-authored free text. They do not cross this boundary.

This is why `pull_requests:read` and `review_findings:read` are kept as their own scopes rather than folded into a broader "reviews" scope: a client that only wants review-run status and cost (`reviews:read`, `cost_events:read`) never has to accept exposure to adversarial content it isn't asking for. Whatever tool implementation lands under F2/O1 for these two scopes should carry an explicit untrusted-content boundary (framing the returned text as data, not instructions, in the tool result)—this document names the requirement; implementing it is out of this issue's delivery boundary.

## Recommended scope vocabulary

Five production scopes, one per capability family, plus one conformance-only scope. Naming follows the donor's `noun:read` shape and this repository's snake_case-for-multi-word-identifiers convention.

| Scope                  | Capability family                         | Gates (illustrative—final names are F2/O1/O2 decisions)                                              | Crosses the injection boundary             |
| ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `repositories:read`    | Repository identity and access            | `list_repositories`, `get_repository`                                                                | No                                         |
| `pull_requests:read`   | Live GitHub pull request content          | `list_pull_requests`, `get_pull_request`                                                             | Yes—author-controlled content              |
| `reviews:read`         | Review run lifecycle and cost estimate    | `list_review_runs`, `get_review_run`                                                                 | No                                         |
| `review_findings:read` | Findings emitted by review runs           | `list_review_findings`, `get_review_finding`                                                         | Yes—reflects reviewed pull request content |
| `cost_events:read`     | Cost ledger                               | `list_cost_events`, `get_cost_summary`                                                               | No                                         |
| `conformance:read`     | Conformance-only fixture, never real data | one synthetic fixture tool, name TBD by whichever issue ports Protokit's `list_audit_events` pattern | No—returns synthetic data only             |

The one-line consent-screen description is the verbatim text a `getSupportedScopes()`-equivalent registry must display, matching the donor's `mcpScopeDescriptions` shape (`packages/mcp/src/scopes.ts`) and rendered the same way the donor's authorize page renders it—one `<li>` per granted or requested scope, the string copied through unmodified:

```typescript
export const mcpScopeDescriptions: Record<TribunalMcpScope, string> = {
  'repositories:read':
    "Read the repositories you've connected to Tribunal, including their name, owner, default branch, and latest commit.",
  'pull_requests:read':
    'Read pull request content from your connected repositories, including titles, descriptions, diffs, and comments.',
  'reviews:read':
    "Read the status, timing, and cost estimate of Tribunal's automated reviews on your pull requests.",
  'review_findings:read':
    "Read the findings Tribunal's review agents reported on your pull requests, including severity, file location, and suggested fixes.",
  'cost_events:read':
    'Read your Tribunal spending history, including estimated review costs by repository and agent.',
  'conformance:read':
    'Conformance-only. Exercises Tribunal MCP protocol test fixtures and grants no access to your repositories, pull requests, findings, or spending.',
};
```

`conformance:read`'s description is documented here for completeness (AC2 asks for every scope, and the donor gives its own conformance-only scope one too) even though, per the next section, it should never actually render on a live consent screen.

## Conformance-only scope: recommendation

Protokit's `audit:read` gates `list_audit_events`, a synthetic fixture tool registered only when `enableConformanceMode` is on, excluded from `getSupportedScopes()` because that function only walks the production registries. The orchestration document's invariant list (`documentation/mcp-integration-orchestration.md`) preserves the same shape for Tribunal: "the DNS-rebinding check is not gated on conformance mode" (TRI-30) and "every advertised MCP capability is handler-backed" (TRI-29) both presuppose a conformance mode exists, separate from production, that protocol test suites (`test:conformance:modern`, `test:conformance:legacy`, `test:connector:inspector` in the donor's script list) exercise without touching real repositories, pull requests, findings, or cost data.

Recommendation: reserve `conformance:read` as Tribunal's equivalent, gating a to-be-named synthetic fixture tool, excluded from `getSupportedScopes()` by construction (the same "only walk production registries" mechanism, not a second exclusion list to keep in sync), and never obtainable through a real `/oauth/authorize` flow because no production client registration or consent screen ever offers it.

Open question: this document reserves the _scope name and mechanism_; it does not specify what the fixture tool returns. That is legitimately downstream of whichever issue ports the donor's `conformance-server.ts` and golden-prompts harness, and should be decided there against Tribunal's actual conformance test needs rather than guessed here.

## Omitted `scope` parameter at authorize time: grants every supported scope

When an authorize request omits `scope` entirely, Tribunal's authorization server grants the full supported set—every scope `getSupportedScopes()` returns, `conformance:read` excluded by the same mechanism that excludes it everywhere else. This is the same default Protokit uses, re-decided here on Tribunal's own capability surface rather than carried over by assumption, for four reasons:

MCP clients are expected to omit `scope` on their authorize request. The only evidence for that is the donor's own `applications/web/src/lib/oauth-scope.ts` doc comment, which names three connectors—Claude, Codex, and ChatGPT—as omitting `scope`. That is Protokit's observation about its own client set, it does not separately cover the Claude hosted connector as a fourth client, and Tribunal has not independently confirmed it for any of them. It is the working assumption behind this default, not a verified fact, and the release gates (TRI-62 through TRI-65) are where each client's actual behaviour gets recorded. A default of "grant nothing" would mean any client that omits `scope` receives a token failing every tool call with `insufficient_scope` on day one, with no code path letting it ask for more. A client that does send an explicit `scope` is unaffected either way: an explicit non-empty list is granted exactly as requested and never expanded.

RFC 6749 section 3.3 explicitly permits "process[ing] the request using a pre-defined default value" for an omitted `scope`, so this is a standards-sanctioned choice, not a workaround.

The actual safety control is the consent screen, not the default. Tribunal has no unattended or anonymous MCP access—every authorize request requires a logged-in Neon Auth session, and whatever scope set is in play (default-all or an explicit narrower request) is listed line by line, using the verbatim descriptions above, before the user approves anything. A default of "grant everything" is not a silent escalation; it is what the user is shown and asked to approve.

A narrower default (for example, `repositories:read` and `reviews:read` only, withholding `pull_requests:read`, `review_findings:read`, and `cost_events:read` unless explicitly requested) does not actually reduce risk for these four clients, because none of them sends an explicit `scope` request today—a narrower default would just mean three of five scopes never work for any of the four target clients until a further Tribunal-side or client-side change adds explicit scope requests. It would also produce a worse failure mode than either extreme: some tools silently work and others silently 403, which is harder for a user to reason about than "I approved everything" or "nothing works."

This default applies to the initial `/oauth/authorize` request only. `oauth-scope.ts`'s companion behavior in the donor is a separate, already-settled rule worth carrying forward unchanged: a present-but-empty `scope=` parameter is not the same as an omitted one and must be rejected as `invalid_scope` (RFC 6749's ABNF requires at least one scope-token, so "empty" cannot mean "give me the default"); an explicit non-empty `scope` list is granted exactly as requested, never expanded; and on a refresh-token request, an omitted `scope` means "keep the token's existing granted scope unchanged," not "reapply the default full set"—a refresh is never an opportunity to widen access the client never explicitly asked to widen.

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

Single-scope-per-primitive versus multi-scope: the donor's `McpToolDefinition` / `McpResourceDefinition` / `McpPromptDefinition` each declare exactly one `requiredScope: McpScope` field, because every Protokit primitive genuinely needs exactly one scope. Tribunal's capability surface makes a genuinely cross-domain primitive plausible for the first time—a prompt template that, say, summarizes a pull request's findings would legitimately need both `pull_requests:read` and `review_findings:read` at once. Whether `requiredScope` becomes `McpScope | McpScope[]` (or an `allOf` of scopes) to express that, or whether Tribunal's first-release primitives are deliberately scoped narrowly enough to avoid the question, is unresolved here and belongs to whichever issue defines Tribunal's actual tool/resource/prompt registry (F2/O1).

Consent-screen preselection UX: this document decides the token-grant default (omitted `scope` grants the full supported set) but not how the consent screen visually presents that—whether it shows one flat "grant everything" approval or a checkbox per scope with some subset preselected. That is a session-binding and consent-flow UI decision, tracked separately as TRI-25, and should read this document's default before making that call rather than re-deriving it.

Conformance fixture content: named above—reserving the `conformance:read` scope and its exclusion mechanism is this document's job; deciding what the fixture tool actually returns is not.

MCP resources versus tools-only: this document proposes illustrative tool names for every scope and does not commit to whether Tribunal's first release also exposes MCP resources (the donor's `user://profile`-style URI resource, with its `resources/subscribe` surface). The orchestration document's invariant list ("one `McpHttpHandler` per authenticated user," "`subscriptions/listen` enforces the same scope check `resources/read` does") describes constraints on that surface _if_ it is ported, but does not itself decide that Tribunal needs resources in a first release rather than tools alone. That decision, too, belongs to F2/O1.
