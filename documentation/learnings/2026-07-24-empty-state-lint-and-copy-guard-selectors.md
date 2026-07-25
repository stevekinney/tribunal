---
date: 2026-07-24
source: pull-request-review
scope: pr-220-empty-states
---

# Empty-state lint selector and copy-convention guard fixes

- `no-restricted-syntax` selectors that guard "is this collection empty"
  must enumerate every AST shape authors actually write, not just one:
  `x.length === 0`, `== 0`, `<= 0`, `< 1`, and `!x.length` are all
  equivalent in intent. Optional chaining (`x?.length`) wraps the
  underlying `MemberExpression` in a `ChainExpression` per the ESTree
  spec, so a selector pinned to `left.type='MemberExpression'` silently
  misses `x?.length === 0` — each shape needs a chained variant too.
- esquery (the selector engine behind ESLint's `no-restricted-syntax`
  AST selectors) supports `:matches(a, b, c)` for OR-combining shapes and
  `:not(ancestor descendant)` for excluding a node that has a specific
  ancestor anywhere up the tree — not just a direct parent. Use
  `:not(SvelteElement[name.name='EmptyState'] SvelteText)` to exclude text
  nested inside a compliant `<EmptyState>` (e.g. an action button's label)
  from a broader "flag any visible text in this fallback" selector.
- svelte-eslint-parser represents both HTML tags and Svelte components as
  `SvelteElement` nodes distinguished by `kind` ('html' | 'component' |
  'special'); both expose `name.name` as a string (`SvelteName.name` for
  HTML, `Identifier.name` for components), so the same attribute-selector
  shape (`[name.name='X']`) works for matching a component name — just add
  `[kind='component']` for precision.
- Before trusting an eslint.config.js `no-restricted-syntax` selector
  change, build a throwaway `.svelte` fixture with one case per violating
  and compliant shape, run `eslint <fixture>` directly, and delete the
  fixture. There's no existing RuleTester-style harness for this repo's
  eslint.config.js, and svelte-check/tsc passing proves nothing about
  selector correctness — only a real parse against real AST shapes does.
- A regex-based copy-convention scanner that strips `${...}` template
  interpolations wholesale (to avoid flagging bare identifiers as prose)
  will also discard any authored string literals nested inside those
  interpolations (e.g. a plural ternary:
  `` `${count} ${count === 1 ? 'repository' : 'repositories'}` ``). Recurse
  into each interpolation's contents and re-run the literal extractor
  there instead of blanking the whole `${...}` span.
- A case-sensitive abbreviation denylist meant to catch prose (`repo`,
  `config`, `org`) must also match the title-case form used at the start
  of a heading or sentence (`Repo`, `Config`, `Org`), while a distinctly
  handled exemption (lowercase `pr` for engine identifiers like
  `review-pr:<id>`) should stay untouched — broadening one abbreviation's
  case-sensitivity doesn't require touching the others.
