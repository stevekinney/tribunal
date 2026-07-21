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
