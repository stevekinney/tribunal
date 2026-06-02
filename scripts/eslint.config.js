import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  { ignores: ['node_modules/**', '.tmp/**', 'tribunal-*.workflow.js'] },
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
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
