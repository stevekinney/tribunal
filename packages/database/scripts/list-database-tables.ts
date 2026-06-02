/**
 * Lists database table names from the schema barrel export.
 *
 * Used by skill dynamic injection (`!`command``) to provide project-aware
 * context to database-related skills at load time.
 *
 * Reads the barrel file only — no compilation, no network.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const schemaBarrelCandidates = [
  resolve(repoRoot, 'packages', 'database', 'src', 'schema', 'index.ts'),
  resolve(repoRoot, 'src', 'lib', 'server', 'database', 'schema.ts'),
];

/** Entries to filter out (not tables). */
const EXCLUDED_ENTRIES = new Set(['types', 'enums', 'relations']);

async function main(): Promise<void> {
  let content: string | null = null;
  for (const schemaBarrelPath of schemaBarrelCandidates) {
    try {
      content = await readFile(schemaBarrelPath, 'utf-8');
      break;
    } catch {
      // Continue to the next known location.
    }
  }

  if (!content) {
    console.log('Schema barrel file not found.');
    return;
  }

  const pattern = /export \* from '\.\/(?:schema\/)?([^']+)'/g;
  const tables: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const name = match[1];
    if (EXCLUDED_ENTRIES.has(name) || name.includes('relations')) continue;
    tables.push(name);
  }

  if (tables.length === 0) {
    console.log('No tables found in schema barrel.');
    return;
  }

  // Wrap to ~80 chars for readable output
  console.log(`Database tables (${tables.length}):`);
  let line = '  ';
  for (let i = 0; i < tables.length; i++) {
    const entry = tables[i] + (i < tables.length - 1 ? ', ' : '');
    if (line.length + entry.length > 80) {
      console.log(line);
      line = '  ' + entry;
    } else {
      line += entry;
    }
  }
  if (line.trim()) {
    console.log(line);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
