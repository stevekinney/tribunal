#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEphemeralBranch, runMigrationsOnBranch } from './neon-branch';
import { validateInvariants, type ValidationResult } from './validate-invariants';

/**
 * Test result metadata
 */
interface TestResult {
  success: boolean;
  timestamp: string;
  branchId: string;
  duration: number;
  validationResult: ValidationResult;
  error?: string;
}

/**
 * Orchestrate the full migration test flow:
 * 1. Create ephemeral Neon branch
 * 2. Run drizzle-kit migrate
 * 3. Validate invariants
 * 4. Write test results
 * 5. Cleanup branch (in finally)
 */
async function runMigrationTests(): Promise<void> {
  const startTime = Date.now();

  // Validate required environment variables
  const projectId = process.env.NEON_PROJECT_ID;
  const apiKey = process.env.NEON_API_KEY;

  if (!projectId) {
    throw new Error('NEON_PROJECT_ID environment variable is required');
  }

  if (!apiKey) {
    throw new Error('NEON_API_KEY environment variable is required');
  }

  console.log('='.repeat(70));
  console.log('Migration Test Runner');
  console.log('='.repeat(70));
  console.log(`Project ID: ${projectId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(70));
  console.log('');

  let branch: Awaited<ReturnType<typeof createEphemeralBranch>> | null = null;
  let testResult: TestResult;

  try {
    // Step 1: Create ephemeral branch
    console.log('Step 1: Creating ephemeral Neon branch...\n');
    branch = await createEphemeralBranch(projectId);
    console.log(`Branch created: ${branch.branchId}\n`);

    // Step 2: Run migrations
    console.log('Step 2: Running migrations...\n');
    await runMigrationsOnBranch(branch.connectionUri);
    console.log('Migrations completed successfully\n');

    // Step 3: Validate invariants
    console.log('Step 3: Validating database invariants...\n');
    const validationResult = await validateInvariants(branch.connectionUri);
    console.log('');

    // Step 4: Prepare test result
    const duration = Date.now() - startTime;
    testResult = {
      success: validationResult.passed,
      timestamp: new Date().toISOString(),
      branchId: branch.branchId,
      duration,
      validationResult,
    };

    // Step 5: Write test results
    console.log('Step 4: Writing test results...\n');
    await writeTestResults(testResult);

    if (!validationResult.passed) {
      console.error('\n::error::Migration tests failed - invariant violations detected');
      validationResult.errors.forEach((error) => {
        console.error(`::error::${error.name}: ${error.errorMessage}`);
      });
    } else {
      console.log('\n✓ All migration tests passed successfully');
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('\n::error::Migration tests failed with error:', errorMessage);

    testResult = {
      success: false,
      timestamp: new Date().toISOString(),
      branchId: branch?.branchId || 'unknown',
      duration,
      validationResult: {
        passed: false,
        checks: [],
        errors: [
          {
            name: 'test_execution',
            passed: false,
            severity: 'error',
            errorMessage: errorMessage,
          },
        ],
        warnings: [],
      },
      error: errorMessage,
    };

    await writeTestResults(testResult);
    throw error;
  } finally {
    // Cleanup: Always delete the branch
    if (branch) {
      console.log('\nStep 5: Cleaning up ephemeral branch...');
      try {
        await branch.cleanup();
        console.log('Cleanup completed successfully');
      } catch (cleanupError) {
        console.error('::warning::Branch cleanup failed:', cleanupError);
        // Don't throw - we want to preserve the original error if one exists
      }
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('Test Summary:');
    console.log('='.repeat(70));
    console.log(`Duration: ${testResult!.duration}ms`);
    console.log(`Result: ${testResult!.success ? '✓ PASSED' : '✗ FAILED'}`);
    console.log('='.repeat(70));
  }

  // Exit with appropriate code
  if (!testResult.success) {
    process.exit(1);
  }
}

/**
 * Write test results to packages/database/test-results/
 */
async function writeTestResults(result: TestResult): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const resultsDir = resolve(currentDir, '../../test-results');

  // Ensure results directory exists
  await mkdir(resultsDir, { recursive: true });

  // Write JSON result file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultPath = resolve(resultsDir, `migration-test-${timestamp}.json`);

  await writeFile(resultPath, JSON.stringify(result, null, 2));

  console.log(`Test results written to: ${resultPath}`);
}

/**
 * CLI execution mode
 */
if (import.meta.main) {
  try {
    await runMigrationTests();
  } catch {
    // Error already logged in runMigrationTests
    process.exit(1);
  }
}
