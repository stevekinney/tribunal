/**
 * Migration consistency check.
 *
 * Detects when the TypeScript schema in `packages/database/src/schema/` has
 * changed but no corresponding migration has been generated. It works by
 * running `drizzle-kit generate` to a temporary directory and checking whether
 * any new SQL files are produced beyond those already committed.
 *
 * Exit 0 = schema and migrations are in sync.
 * Exit 1 = drift detected (new migration SQL was generated).
 *
 * Usage: bun run scripts/check-migration-consistency.ts
 */

import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { bold, checkmark, cross, dim, error, sectionHeader, success } from './lib/colors';

const databasePackageDirectory = resolve(import.meta.dir, '..');
const existingMigrationsDirectory = resolve(databasePackageDirectory, 'drizzle');
const schemaPath = resolve(databasePackageDirectory, 'src/schema/index.ts');

async function getExistingSqlFiles(): Promise<Set<string>> {
  const entries = await readdir(existingMigrationsDirectory);
  return new Set(entries.filter((entry) => entry.endsWith('.sql')));
}

async function main(): Promise<void> {
  console.log(sectionHeader('Migration Consistency Check'));
  console.log(dim('  Checking for schema-to-migration drift...\n'));

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tribunal-migration-check-'));

  try {
    // Copy existing meta/ so drizzle-kit can diff against the current journal.
    const existingMetaDirectory = resolve(existingMigrationsDirectory, 'meta');
    const temporaryMetaDirectory = resolve(temporaryDirectory, 'meta');
    await cp(existingMetaDirectory, temporaryMetaDirectory, { recursive: true });

    // Copy existing SQL files so drizzle-kit sees the full migration history.
    const existingSqlFiles = await getExistingSqlFiles();
    for (const sqlFile of existingSqlFiles) {
      await cp(resolve(existingMigrationsDirectory, sqlFile), resolve(temporaryDirectory, sqlFile));
    }

    console.log(dim(`  Temporary output: ${temporaryDirectory}`));
    console.log(dim(`  Existing migrations: ${existingSqlFiles.size} SQL files\n`));

    // drizzle-kit does not allow --config combined with --out, so we write a
    // temporary config inside the database package directory (so drizzle-kit
    // module resolution works) that redirects output to the temp directory.
    const temporaryConfigPath = resolve(
      databasePackageDirectory,
      '.drizzle-consistency-check.config.ts',
    );
    const temporaryConfigContent = [
      `import { defineConfig } from 'drizzle-kit';`,
      `export default defineConfig({`,
      `  schema: ${JSON.stringify(schemaPath)},`,
      `  out: ${JSON.stringify(relative(databasePackageDirectory, temporaryDirectory))},`,
      `  dialect: 'postgresql',`,
      `  verbose: true,`,
      `  strict: true,`,
      `});`,
    ].join('\n');
    await writeFile(temporaryConfigPath, temporaryConfigContent, 'utf-8');

    // Run drizzle-kit generate using the temporary config.
    const generateProcess = Bun.spawn(
      ['bunx', 'drizzle-kit', 'generate', '--config', temporaryConfigPath],
      {
        cwd: databasePackageDirectory,
        stdio: ['inherit', 'pipe', 'pipe'],
      },
    );

    // Read pipes immediately to avoid buffer deadlock.
    const stdoutPromise = new Response(generateProcess.stdout).text();
    const stderrPromise = new Response(generateProcess.stderr).text();

    const exitCode = await generateProcess.exited;
    const stdout = await stdoutPromise;
    const stderr = await stderrPromise;

    if (exitCode !== 0) {
      console.log(`  ${cross} ${error('drizzle-kit generate failed')}`);
      if (stdout.trim()) console.log(dim(stdout.trim()));
      if (stderr.trim()) console.log(error(stderr.trim()));
      throw new Error(`drizzle-kit generate exited with code ${exitCode}`);
    }

    // Check for newly generated SQL files.
    const temporaryEntries = await readdir(temporaryDirectory);
    const newSqlFiles = temporaryEntries.filter(
      (entry) => entry.endsWith('.sql') && !existingSqlFiles.has(entry),
    );

    if (newSqlFiles.length > 0) {
      console.log(`  ${cross} ${error('Schema drift detected!')}\n`);
      console.log(bold('  New migration files that would be generated:'));
      for (const file of newSqlFiles) {
        console.log(`    ${error('+')} ${file}`);
      }
      console.log('');
      console.log(bold('  To fix this, run:'));
      console.log(success('    bun run db:generate -- --name describe-your-change'));
      console.log('');
      console.log(dim('  This ensures migrations stay in sync with schema changes.'));
      throw new Error('Schema drift detected: uncommitted migration SQL was generated.');
    }

    console.log(`  ${checkmark} ${success('Schema and migrations are in sync.')}`);
  } finally {
    // Clean up the temporary config placed inside the database package.
    const temporaryConfigCleanupPath = resolve(
      databasePackageDirectory,
      '.drizzle-consistency-check.config.ts',
    );
    await rm(temporaryConfigCleanupPath, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main();
