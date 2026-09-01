import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const requiredCommands = ['git', 'node', 'bun'];

export const runtimePackageChecks = [
  {
    packageName: '@anthropic-ai/claude-agent-sdk',
    verify: (module) => typeof module.query === 'function',
  },
  {
    packageName: '@tribunal/agents',
    verify: (module) =>
      Array.isArray(module.READ_ONLY_AGENT_TOOLS) &&
      typeof module.enforceReadOnlyToolUse === 'function',
  },
];

export async function runReviewerImageChecks({
  commandRunner = spawnSync,
  pathExists = existsSync,
  importModule = (packageName) => import(packageName),
  runnerFileUrl = new URL('./verify-image.mjs', import.meta.url),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const missingCommands = [];
  for (const command of requiredCommands) {
    const result = commandRunner(command, ['--version'], {
      stdio: 'ignore',
      // Version checks are local executable probes. Five seconds allows cold
      // startup while bounding a corrupt executable or filesystem stall.
      timeout: 5_000,
      killSignal: 'SIGKILL',
    });
    if (result.error instanceof Error && result.error.code === 'ETIMEDOUT') {
      stderr.write(`Reviewer image command check timed out: ${command}\n`);
      return 1;
    }
    if (result.status !== 0) missingCommands.push(command);
  }

  if (missingCommands.length > 0) {
    stderr.write(`Reviewer image is missing required commands: ${missingCommands.join(', ')}\n`);
    return 1;
  }

  if (!pathExists(runnerFileUrl)) {
    stderr.write('Reviewer image runner directory is not readable.\n');
    return 1;
  }

  for (const check of runtimePackageChecks) {
    try {
      const importedModule = await importModule(check.packageName);
      if (!check.verify(importedModule)) {
        stderr.write(`Reviewer image runtime package failed shape check: ${check.packageName}\n`);
        return 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Reviewer image cannot import ${check.packageName}: ${message}\n`);
      return 1;
    }
  }

  stdout.write('Reviewer image self-check passed.\n');
  return 0;
}
