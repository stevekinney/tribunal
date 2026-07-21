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
      'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }],
      complexity: ['error', { max: 23 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  ...oxlint.buildFromOxlintConfigFile('../../.oxlintrc.json'),
);
