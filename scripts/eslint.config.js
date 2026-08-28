import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  { ignores: ['node_modules/**', '.tmp/**', 'coverage/**', 'tribunal-*.workflow.js'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-undef': 'off',
      'max-lines': ['error', { max: 2400, skipBlankLines: true, skipComments: true }],
      complexity: ['error', { max: 55 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // TRI-34. Duplicated from `.oxlintrc.json` rather than inherited,
      // because this is the one workspace whose `lint` script runs `eslint`
      // alone -- every other one runs `oxlint . && eslint .`, so the root
      // oxlint config already covers them. Without this copy, `scripts/` is
      // a hole in a rule that claims to be repo-wide.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'bun:test',
              message:
                "Tribunal's test runner is vitest. Import from 'vitest' instead — bun:test's mock()/spyOn() and per-file process isolation have no equivalent here, so a bun:test suite silently does not run under the configured runner.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
