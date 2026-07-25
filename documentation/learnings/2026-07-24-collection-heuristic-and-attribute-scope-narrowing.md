---
date: 2026-07-24
source: pull-request-review
scope: pr-220-empty-states
---

# Collection heuristic and non-prose attribute narrowing

- ESLint `no-restricted-syntax` selectors have no type information: a
  `.length` member-expression selector can't tell a `string` from an array,
  so `{#if searchQuery.length === 0}` reads identically to
  `{#if items.length === 0}`. A purely structural stand-in that doesn't
  require a custom type-aware rule: require the guard's subtree to contain
  an `{#each}` block (esquery `:has(SvelteEachBlock)`). A string check has
  no reason to pair with one; a real list fallback does, since something
  has to render the populated branch. This narrows false positives without
  losing true positives, since a violation this rule is meant to catch
  always has a real `{#each}` rendering the list in the sibling branch.
- A copy-convention scanner that treats every quoted string/template
  literal in a `.svelte` file as potential user-facing prose will flag
  URLs and path segments too (`href="https://github.com/orgs/acme"`
  contains the whole word "orgs"). Fix by excluding attribute _values_
  that are never rendered text — `href`/`src`/`action`/`formaction`
  (URLs), `rel`/`target` (enums), `name`/`type` (form/element enums),
  `data-*` (scripting hooks) — while deliberately leaving attributes that
  _do_ carry visible text alone (`aria-label`, `alt`, `title`,
  `placeholder`, `value`).
- Don't extend that exclusion to `<script>`-level string/template literal
  constants (e.g. a hypothetical OAuth scope array) even when a reviewer
  flags a false-positive risk there: the scanner's whole stated purpose is
  to catch prose _assembled_ in `<script>` (derived subtitles, formatted
  labels), so broadly excluding "config-looking" script strings would
  reopen exactly the class of miss the tool exists to prevent. Prefer the
  file's existing `EXCLUDED_FILES`-with-documented-reason pattern for any
  concrete instance that actually arises, over a heuristic that can't
  reliably distinguish config data from prose without real type/semantic
  information.
- When a lint-selector fix narrows what counts as a violation, re-verify
  with a fixture that both the previously-passing compliant cases _and_
  the newly-excluded false-positive case behave correctly in the same run
  — a heuristic that fixes one review comment can silently regress an
  earlier one if the fixture isn't re-run end-to-end.
