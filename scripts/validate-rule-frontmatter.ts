#!/usr/bin/env bun
import { resolve } from 'node:path';

import { validateRuleFrontmatter } from './lib/rule-frontmatter-validation';

const repositoryRoot = resolve(import.meta.dir, '..');
const errors = validateRuleFrontmatter(repositoryRoot);

if (errors.length > 0) {
  console.error('Rule frontmatter validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Rule frontmatter validation passed.');
