import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';
import oxlint from 'eslint-plugin-oxlint';

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
    ignores: [
      'test/**/*',
      // Concurrently restructured by another change; has two genuine
      // hand-rolled empty states (one at :385). Remove this entry — do not
      // weaken the rule — once that restructuring lands and fixes them.
      // Tracked in the pull request description.
      'src/routes/(authenticated)/repositories/+page.svelte',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "SvelteIfBlock[expression.type='BinaryExpression'][expression.operator='==='][expression.left.type='MemberExpression'][expression.left.property.name='length'][expression.right.value=0] > SvelteElement[kind='html'][name.name='p'], SvelteIfBlock[expression.type='BinaryExpression'][expression.operator='==='][expression.left.type='MemberExpression'][expression.left.property.name='length'][expression.right.value=0] > :not(SvelteElseBlock) SvelteElement[kind='html'][name.name='p']",
          message:
            'Render <EmptyState> from @lostgradient/cinder/empty-state for a `.length === 0` branch instead of a bare <p>. A hand-rolled paragraph drops the accessible group labelling EmptyState provides.',
        },
        {
          selector: 'SvelteEachBlock > SvelteElseBlock SvelteText[value=/\\S/]',
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
);
