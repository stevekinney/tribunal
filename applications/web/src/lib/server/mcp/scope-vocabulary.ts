import { defineScopes } from '@lostgradient/mcp';

/**
 * Tribunal's OAuth scope vocabulary, settled by TRI-24 and recorded in
 * `documentation/mcp-scopes.md`.
 *
 * This is a named module-level binding rather than an object assembled inline
 * at the seam-wiring call site, because two other issues need to import the
 * production vocabulary itself: the hook-chain mount injects it, and the
 * authorize-path verification asserts that the *production* set is non-empty
 * and matches this document. A vocabulary constructed inline leaves those
 * tests nothing to pin to except a hand-rolled look-alike, which proves
 * nothing about what the mount actually serves.
 *
 * The descriptions are consent-screen copy, rendered verbatim on the authorize
 * page — one line per requested scope. Two properties the engine enforces and
 * this vocabulary must not undermine: every primitive declares exactly one
 * scope from this set, and there is no generic all-access scope.
 *
 * `conformance:read` is deliberately part of the vocabulary and declared only
 * by the conformance-only fixture (`conformance-fixture.ts`, registered under
 * `conformanceOnlyTools` by TRI-30), never by a production primitive.
 * `getSupportedScopes()` walks the production registries alone, so the scope is
 * excluded from advertised metadata structurally rather than by a second
 * exclusion list somebody has to remember to update — and the authorize
 * endpoint's "reject any scope outside the supported set" rule then makes it
 * unobtainable as a consequence of the mechanism.
 */
export const tribunalScopeVocabulary = defineScopes({
  'repositories:read':
    "Read the repositories you've connected to Tribunal, including their name, owner, default branch, and latest commit.",
  /**
   * Rewritten from the wording `documentation/mcp-scopes.md` originally
   * proposed, which promised diffs and comment text. That document names
   * adjusting this string as one of two acceptable resolutions and requires
   * this issue to pick one explicitly: Tribunal has no reusable reader for
   * either — pull request content is never stored, `getPullRequest` returns
   * the body plus numeric comment counts, and diff data reaches the system
   * only through the review diff-context service.
   *
   * The rule the copy has to satisfy is that it describes what the tools
   * return — no more, and no less. An earlier revision here only dropped the
   * over-promise, which left the opposite mismatch: branch names, links,
   * timestamps, change counts, and commit SHAs were all being returned under a
   * sentence that mentioned none of them. Review caught it. The enumeration
   * below is the projection, written out.
   */
  'pull_requests:read':
    'Read pull request details from your connected repositories: title, description, author, branch names, commit SHAs, link, timestamps, changed-file and line counts, comment and commit counts, and the CI, review, and merge status Tribunal recorded. Diffs and comment text are not included.',
  'reviews:read':
    "Read the status, timing, and cost estimate of Tribunal's automated reviews in your connected repositories.",
  'review_findings:read':
    "Read the findings Tribunal's review agents reported in your connected repositories, including severity, file location, and suggested fixes.",
  'cost_events:read':
    'Read your Tribunal spending history, including estimated review costs by repository and agent.',
  'conformance:read':
    'Conformance-only. Exercises Tribunal MCP protocol test fixtures and grants no access to your repositories, pull requests, findings, or spending.',
});

/** Every scope Tribunal's vocabulary can express, conformance included. */
export type TribunalMcpScope = (typeof tribunalScopeVocabulary)['scopes'][number];
