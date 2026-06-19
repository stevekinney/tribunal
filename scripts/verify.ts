/**
 * Comprehensive local verification script.
 *
 * Runs all CI checks plus hook-only gates (migration consistency),
 * sequentially, with pass/fail/duration summary.
 * Use this before pushing when you want full confidence without waiting for CI.
 *
 * Usage: bun run verify
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { bold, checkmark, cross, dim, error, info, sectionHeader, success } from './lib/colors';

interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  continueOnError?: boolean;
}

const checks: { name: string; command: string[]; continueOnError?: boolean }[] = [
  { name: 'Lockfile sync', command: ['bun', 'install', '--frozen-lockfile'] },
  { name: 'Type check', command: ['bun', 'run', 'check'] },
  { name: 'Format check', command: ['bun', 'run', 'format:check'] },
  { name: 'Lint', command: ['bun', 'run', 'lint'] },
  {
    name: 'Unit tests (server)',
    command: ['bun', 'run', '--cwd', 'applications/web', 'test:unit:server', '--', '--run'],
  },
  {
    name: 'Unit tests (client)',
    command: ['bun', 'run', '--cwd', 'applications/web', 'test:unit:client', '--', '--run'],
  },
  {
    name: 'Review engine coverage',
    command: ['bun', 'run', 'test:coverage:review-engine'],
  },
  { name: 'Build', command: ['bun', 'run', 'build'] },
  {
    name: 'Migration consistency',
    command: ['bun', 'run', '--cwd', 'packages/database', 'check:migrations'],
  },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

async function runCheck(check: (typeof checks)[number]): Promise<CheckResult> {
  const line = '─'.repeat(60);
  console.log(`\n${dim(line)}`);
  console.log(`${info('▶')} ${bold(check.name)}`);
  console.log(dim(line));

  const start = performance.now();
  const proc = Bun.spawn(check.command, {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: resolve(import.meta.dir, '..'),
  });
  const exitCode = await proc.exited;
  const durationMs = Math.round(performance.now() - start);

  const passed = exitCode === 0;
  const icon = passed ? checkmark : cross;
  const suffix = !passed && check.continueOnError ? dim(' (non-blocking)') : '';
  const label = passed ? success('PASS') : error('FAIL');
  console.log(
    `\n${icon} ${label} ${bold(check.name)}${suffix} ${dim(`(${formatDuration(durationMs)})`)}`,
  );

  return { name: check.name, passed, durationMs, continueOnError: check.continueOnError };
}

/**
 * Checks that workspace scripts do not import across ownership boundaries.
 * Returns a list of violations (empty = pass).
 */
function checkScriptOwnershipBoundaries(rootDirectory: string): string[] {
  const violations: string[] = [];

  const boundaryRules = [
    {
      description: 'packages/database/scripts must not import root scripts/lib',
      directory: join(rootDirectory, 'packages/database/scripts'),
      pattern: /\.\.\/\.\.\/\.\.\/scripts\/lib/,
    },
  ];

  function scanDirectory(directory: string, pattern: RegExp, description: string): void {
    let entries: string[];
    try {
      entries = readdirSync(directory, { recursive: true, encoding: 'utf-8' }) as string[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
      if (entry.includes('node_modules')) continue;
      const filePath = join(directory, entry);
      try {
        const content = readFileSync(filePath, 'utf-8');
        if (pattern.test(content)) {
          violations.push(`${description}: ${filePath}`);
        }
      } catch {
        // Skip unreadable files.
      }
    }
  }

  for (const rule of boundaryRules) {
    scanDirectory(rule.directory, rule.pattern, rule.description);
  }

  // Check package.json files for stale root script references
  const packageJsonPaths = [
    join(rootDirectory, 'applications/web/package.json'),
    join(rootDirectory, 'packages/components/package.json'),
  ];
  const stalePackageJsonPattern = /\.\.\/\.\.\/scripts\/testing\//;
  for (const packageJsonPath of packageJsonPaths) {
    try {
      const content = readFileSync(packageJsonPath, 'utf-8');
      if (stalePackageJsonPattern.test(content)) {
        violations.push(`package.json references stale root testing path: ${packageJsonPath}`);
      }
    } catch {
      // Skip unreadable files.
    }
  }

  return violations;
}

async function main() {
  console.log(sectionHeader('Local Verification'));

  // Run script ownership boundary check first (fast, no subprocess needed)
  const rootDirectory = resolve(import.meta.dir, '..');
  const boundaryViolations = checkScriptOwnershipBoundaries(rootDirectory);
  if (boundaryViolations.length > 0) {
    console.log(`\n${cross} ${error('Script ownership boundary violations detected:')}`);
    for (const violation of boundaryViolations) {
      console.log(`  ${error('•')} ${violation}`);
    }
    console.log('');
    console.log(dim('  See scripts/OWNERSHIP.md for the correct import patterns.'));
    process.exit(1);
  }
  console.log(`${checkmark} ${success('Script ownership boundaries verified')}\n`);

  console.log(dim(`  Running ${checks.length} checks...\n`));

  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
  }

  // Summary
  const passedResults = results.filter((r) => r.passed);
  const failedResults = results.filter((r) => !r.passed);
  const blockingFailures = failedResults.filter((r) => !r.continueOnError);
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log('\n' + '═'.repeat(60));
  console.log(bold('  Summary'));
  console.log('═'.repeat(60));

  for (const r of results) {
    const icon = r.passed ? checkmark : cross;
    const suffix = !r.passed && r.continueOnError ? dim(' (non-blocking)') : '';
    const duration = dim(`(${formatDuration(r.durationMs)})`);
    console.log(`  ${icon} ${r.name}${suffix} ${duration}`);
  }

  console.log('─'.repeat(60));
  console.log(
    `  ${success(`${passedResults.length} passed`)}, ${failedResults.length > 0 ? error(`${failedResults.length} failed`) : dim('0 failed')}  ${dim(`Total: ${formatDuration(totalMs)}`)}`,
  );
  console.log('═'.repeat(60));

  if (blockingFailures.length > 0) {
    process.exit(1);
  }
}

main();
