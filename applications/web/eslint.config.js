import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';
import oxlint from 'eslint-plugin-oxlint';

/**
 * Every AST shape that means "this collection/list is empty", scoping the
 * `no-restricted-syntax` empty-state entries below to `{#if}` blocks that
 * actually guard emptiness: `x.length === 0`, `== 0`, `<= 0`, `< 1`, and
 * `!x.length`. Each variant is duplicated for optional-chained member access
 * (`x?.length`), which the ESTree spec wraps in a `ChainExpression` one
 * level above the underlying `MemberExpression`.
 */
const EMPTY_LENGTH_CHECKS = [
  ...['===', '==', '<='].flatMap((operator) => [
    `[expression.type='BinaryExpression'][expression.operator='${operator}'][expression.left.type='MemberExpression'][expression.left.property.name='length'][expression.right.value=0]`,
    `[expression.type='BinaryExpression'][expression.operator='${operator}'][expression.left.type='ChainExpression'][expression.left.expression.type='MemberExpression'][expression.left.expression.property.name='length'][expression.right.value=0]`,
  ]),
  "[expression.type='BinaryExpression'][expression.operator='<'][expression.left.type='MemberExpression'][expression.left.property.name='length'][expression.right.value=1]",
  "[expression.type='BinaryExpression'][expression.operator='<'][expression.left.type='ChainExpression'][expression.left.expression.type='MemberExpression'][expression.left.expression.property.name='length'][expression.right.value=1]",
  "[expression.type='UnaryExpression'][expression.operator='!'][expression.argument.type='MemberExpression'][expression.argument.property.name='length']",
  "[expression.type='UnaryExpression'][expression.operator='!'][expression.argument.type='ChainExpression'][expression.argument.expression.type='MemberExpression'][expression.argument.expression.property.name='length']",
];

/**
 * `no-restricted-syntax` selectors have no type information, so a plain
 * `.length` member access matches a `string` exactly the same as an array
 * (`searchQuery.length === 0` reads identically to `items.length === 0`).
 * Requiring an `{#each}` block somewhere nearby is a purely-structural
 * stand-in for "this is actually a collection": a string length check has
 * no reason to render one, while a real list fallback pairs with the
 * `{#each}` that renders its populated branch.
 *
 * "Nearby" has to mean more than "inside the `{#if}` block's own subtree".
 * The populated list can also be rendered as a *sibling* of the guard
 * instead of in its `{:else}` — see `runs/[runId]/+page.svelte`'s
 * agent-runs section, where `{#if run.agentRuns.length === 0}...{/if}` is
 * immediately followed by a sibling `{#each run.agentRuns as agentRun}`.
 * esquery's `:has()` only traverses *descendants* of the node it's applied
 * to (see estraverse.traverse in esquery's `has` matcher) — there is no way
 * to express "has a sibling matching X" from the `{#if}` node itself, and
 * `:has(~ X)` silently matches nothing rather than erroring, which is what
 * made this gap easy to miss. The fix moves the `:has(SvelteEachBlock)`
 * check up to the *shared parent* of both blocks (a `<section>`, `<Card>`,
 * or the component root) and asks for the `{#if}` as one of its direct
 * children: the each-block only has to be somewhere in the parent's
 * subtree, which covers both the nested-in-`{:else}` case and the
 * sibling-in-the-same-container case, without reaching into unrelated
 * content elsewhere on the page (the `> SvelteIfBlock` keeps it scoped to a
 * direct child, not just page-wide "there's an each-block somewhere").
 */
function requireNearbyEachBlock(ifBlockSelector) {
  return `*:has(SvelteEachBlock) > ${ifBlockSelector}`;
}

const EMPTY_LENGTH_SELECTOR = requireNearbyEachBlock(
  `SvelteIfBlock:matches(${EMPTY_LENGTH_CHECKS.join(', ')})`,
);

/**
 * The mirror image of `EMPTY_LENGTH_CHECKS`: AST shapes that mean "this
 * collection is non-empty" (`x.length` truthy, `x.length > 0`, `x.length >=
 * 1`, plus optional-chained variants). A `{#if}` guarded this way renders its
 * populated list in the `then` branch and its empty state in `{:else}` — the
 * inverse layout from `EMPTY_LENGTH_SELECTOR`, so the `<p>` guard below
 * targets the `else` branch instead of excluding it.
 */
const NONEMPTY_LENGTH_CHECKS = [
  "[expression.type='MemberExpression'][expression.property.name='length']",
  "[expression.type='ChainExpression'][expression.expression.type='MemberExpression'][expression.expression.property.name='length']",
  "[expression.type='BinaryExpression'][expression.operator='>'][expression.left.type='MemberExpression'][expression.left.property.name='length'][expression.right.value=0]",
  "[expression.type='BinaryExpression'][expression.operator='>'][expression.left.type='ChainExpression'][expression.left.expression.type='MemberExpression'][expression.left.expression.property.name='length'][expression.right.value=0]",
  "[expression.type='BinaryExpression'][expression.operator='>='][expression.left.type='MemberExpression'][expression.left.property.name='length'][expression.right.value=1]",
  "[expression.type='BinaryExpression'][expression.operator='>='][expression.left.type='ChainExpression'][expression.left.expression.type='MemberExpression'][expression.left.expression.property.name='length'][expression.right.value=1]",
];

const NONEMPTY_LENGTH_SELECTOR = requireNearbyEachBlock(
  `SvelteIfBlock:matches(${NONEMPTY_LENGTH_CHECKS.join(', ')})`,
);

export default defineConfig(
  {
    ignores: [
      'build/**',
      'coverage/**',
      'drizzle/**',
      'static/**',
      'node_modules/**',
      '.svelte-kit/**',
      '.vercel/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-undef': 'off',
      'svelte/no-navigation-without-resolve': 'off',
      'max-lines': ['error', { max: 900, skipBlankLines: true, skipComments: true }],
      complexity: ['error', { max: 52 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    ignores: ['test/**/*'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Empty collections/lists must render Cinder's <EmptyState>, not a bare
    // paragraph or unwrapped text. A hand-rolled `<p>No X yet.</p>` silently
    // drops the accessible group labelling EmptyState provides (role="group"
    // + aria-labelledby to its title). See .claude/skills/component-standards.
    //
    files: ['src/**/*.svelte'],
    ignores: ['test/**/*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `${EMPTY_LENGTH_SELECTOR} > SvelteElement[kind='html'][name.name='p'], ${EMPTY_LENGTH_SELECTOR} > :not(SvelteElseBlock) SvelteElement[kind='html'][name.name='p']`,
          message:
            'Render <EmptyState> from @lostgradient/cinder/empty-state for a `.length` empty check instead of a bare <p>. A hand-rolled paragraph drops the accessible group labelling EmptyState provides.',
        },
        {
          selector: `${NONEMPTY_LENGTH_SELECTOR} > SvelteElseBlock SvelteElement[kind='html'][name.name='p']`,
          message:
            'Render <EmptyState> from @lostgradient/cinder/empty-state for the empty branch of a `.length` nonempty guard instead of a bare <p>. A hand-rolled paragraph drops the accessible group labelling EmptyState provides.',
        },
        {
          selector:
            "SvelteEachBlock > SvelteElseBlock SvelteText[value=/\\S/]:not(SvelteElement[kind='component'][name.name='EmptyState'] SvelteText)",
          message:
            'An {#each}{:else} fallback renders when the collection is empty — use <EmptyState> from @lostgradient/cinder/empty-state instead of raw text so the empty state gets a labelled group and (optionally) an icon/action.',
        },
      ],
    },
  },
  {
    files: ['test/**/*.svelte'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
    rules: {
      'svelte/require-each-key': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  ...oxlint.buildFromOxlintConfigFile('../../.oxlintrc.json'),
  {
    // TRI-111. `getInstallationForRepository` takes no user: it returns the
    // repository's most recently added active link, the same answer for every
    // caller. A repository can carry active links for two installations — a
    // transfer that leaves the previous organization's link behind is the
    // ordinary way — so on a user-facing path it can hand a caller a client
    // for an installation they were never authorized through. Authorization
    // says a caller may read *a* repository; it does not say which
    // installation's view of it they are entitled to.
    //
    // Resolve the installation from the caller's own access
    // (`resolveAuthorizedInstallationId`) and build the client with
    // `getInstallationForRepositoryAsCaller`, which re-checks that
    // installation against the link table. The unscoped helper remains correct
    // for webhook and background work, which has no caller to scope to.
    // Declared after the oxlint spread below deliberately:
    // `buildFromOxlintConfigFile` switches off every ESLint rule oxlint also
    // owns, `no-restricted-imports` among them, and it is spread last. A block
    // placed earlier resolves to severity 0 and silently enforces nothing —
    // verified by `eslint --print-config`, after the rule appeared to pass on
    // a file that violated it.
    // Every server-only entry point, not just the two obvious directories.
    // `src/hooks.server.ts` is top-level request-path code and a
    // routes-plus-lib-server pair silently excluded it — the kind of gap a
    // scope described as "request paths" invites.
    files: ['src/routes/**/*.ts', 'src/lib/server/**/*.ts', 'src/hooks.server.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tribunal/github/repositories/service',
              importNames: ['getInstallationForRepository'],
              message:
                'Takes no user, so it can return an installation the caller was not authorized through. On a request path use resolveAuthorizedInstallationId + getInstallationForRepositoryAsCaller. See TRI-111.',
            },
          ],
        },
      ],
    },
  },
);
