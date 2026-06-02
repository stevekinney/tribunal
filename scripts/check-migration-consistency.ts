/**
 * Delegate migration consistency check to the database package implementation.
 *
 * The pre-commit hook references this script when database schema files
 * are staged. It delegates to the real checker in packages/database/scripts/
 * which detects schema-to-migration drift by running drizzle-kit generate
 * to a temporary directory and checking for new SQL files.
 */
import { join } from 'node:path';

const checkerPath = join(
  import.meta.dir,
  '..',
  'packages',
  'database',
  'scripts',
  'check-migration-consistency.ts',
);

const checkProcess = Bun.spawn(['bun', 'run', checkerPath], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

const exitCode = await checkProcess.exited;
process.exit(exitCode);
