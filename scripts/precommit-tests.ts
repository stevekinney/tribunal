#!/usr/bin/env bun
/**
 * Pre-commit test runner that:
 * 1. Runs tests for affected projects
 * 2. Detects obsolete snapshots and fails with guidance
 */

async function main() {
  // Allow skipping tests entirely (e.g., for large reformatting commits)
  if (process.env.SKIP_TESTS === '1') {
    console.log('SKIP_TESTS=1 set, skipping pre-commit tests.');
    process.exit(0);
  }

  try {
    const projects = ['server', 'client'];

    // Run vitest with verbose reporter to capture snapshot warnings
    // --changed: only run tests for files that changed since the last commit
    //            (Vitest compares HEAD against the working tree, not staged files)
    // --bail 1: stop on first failure to fail fast
    const vitestArgs = [
      'vitest',
      'run',
      '-c',
      'applications/web/vite.config.ts',
      '--reporter=verbose',
      '--changed',
      '--bail',
      '1',
    ];
    for (const project of projects) {
      vitestArgs.push('--project', project);
    }

    const proc = Bun.spawn(vitestArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Collect output to scan for obsolete snapshots
    // Use separate decoders for each stream to avoid state corruption
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    let stdout = '';
    let stderr = '';

    const stdoutReader = proc.stdout.getReader();
    const stderrReader = proc.stderr.getReader();

    // Read streams concurrently
    const [stdoutChunks, stderrChunks] = await Promise.all([
      (async () => {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          chunks.push(value);
          // Echo to console in real-time
          process.stdout.write(value);
        }
        return chunks;
      })(),
      (async () => {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          chunks.push(value);
          // Echo to console in real-time
          process.stderr.write(value);
        }
        return chunks;
      })(),
    ]);

    // Concatenate chunks using separate decoders
    for (const chunk of stdoutChunks) {
      stdout += stdoutDecoder.decode(chunk, { stream: true });
    }
    // Flush any remaining buffered bytes
    stdout += stdoutDecoder.decode();

    for (const chunk of stderrChunks) {
      stderr += stderrDecoder.decode(chunk, { stream: true });
    }
    // Flush any remaining buffered bytes
    stderr += stderrDecoder.decode();

    const exitCode = await proc.exited;

    // Check for obsolete snapshots
    const combinedOutput = stdout + stderr;
    const hasObsoleteSnapshots = /obsolete snapshot/i.test(combinedOutput);

    if (hasObsoleteSnapshots) {
      console.error('\n❌ Obsolete snapshots detected.');
      console.error(
        '\nThis usually happens when tests are deleted or renamed without updating snapshots.',
      );
      console.error('\nTo fix:');
      console.error('  - Run: bun run test -- --update --run');
      console.error('  - Review the changes to ensure snapshots are correct');
      console.error('  - Stage the updated snapshot files\n');
      process.exit(1);
    }

    process.exit(exitCode);
  } catch (error) {
    console.error(
      'Failed to run pre-commit tests:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

main();
