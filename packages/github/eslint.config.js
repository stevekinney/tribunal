import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import oxlint from 'eslint-plugin-oxlint';

export default defineConfig(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-undef': 'off',
      'max-lines': ['error', { max: 1100, skipBlankLines: true, skipComments: true }],
      complexity: ['error', { max: 44 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Block new direct getCached/setCache usage — use cachedRead instead.
  // Existing exceptions are listed in the override below.
  {
    files: ['src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      // cachedRead implementation uses getCached/setCache internally
      'src/core/github-read-client.ts',
      // Non-API-read caching (computed artifacts, access checks, rate-limit state)
      'src/pull-requests/project-dependencies.ts',
      'src/pull-requests/project-summaries.ts',
      'src/installations/access.ts',
      'src/core/rate-limits.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='getCached']",
          message:
            'Use cachedRead() from core/github-read-client.ts instead of direct getCached calls. See .claude/rules/github-api.md.',
        },
        {
          selector: "CallExpression[callee.property.name='setCache']",
          message:
            'Use cachedRead() from core/github-read-client.ts instead of direct setCache calls. See .claude/rules/github-api.md.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  ...oxlint.buildFromOxlintConfigFile('../../.oxlintrc.json'),
);
