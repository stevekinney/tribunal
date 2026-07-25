---
date: 2026-07-24
source: pull-request-review
scope: pr-220-empty-states
---

# Nonempty-guard selector and nested-template literal scanner fixes

- A `.length`-based empty-state lint selector that only checks the `{#if}`
  branch for "is empty" conditions (`x.length === 0`) misses the mirror
  case: `{#if x.length}` / `{#if x.length > 0}` guards render their empty
  state in `{:else}`, not `{#if}`. Both directions need their own selector,
  each targeting the branch that actually holds the fallback — and a
  regression fixture must confirm the two don't overlap (an
  `{#if x.length === 0}<p/>{:else}<p/>{/if}` should report exactly once,
  on the empty branch only).
- svelte-eslint-parser's `SvelteIfBlock` visitor keys are `["expression",
"children", "else"]` — the `else` field (holding the `SvelteElseBlock`)
  is a real traversal child, so `SvelteIfBlock > SvelteElseBlock ...` is a
  valid, meaningful esquery child-combinator selector, not just a
  convenient-looking string.
- A regex-based literal scanner that stops at the first unescaped backtick
  cannot correctly find the end of a template literal containing a
  _nested_ template literal inside a `${...}` interpolation (e.g.
  `` `${cond ? `PR #${n}` : ''}` ``) — the inner literal's opening backtick
  gets mistaken for the outer literal's close, and the content between the
  two bogus matches (including any authored prose) is silently skipped.
  Fix: a small hand-rolled scanner that tracks `${...}` as a balanced unit
  (brace-depth counting, deferring to the same literal-end scan for any
  nested quote/backtick found inside), recursing into each interpolation's
  text to find further-nested literals. See
  `applications/web/test/copy-conventions.test.ts`
  (`findLiteralEnd`/`findInterpolationEnd`/`collectLiterals`).
- When fixing this class of scanner bug, re-run the _full_ test suite, not
  just the file you touched — a more thorough scanner can surface a
  previously-invisible violation in real source that the old, buggier
  scanner silently missed.
