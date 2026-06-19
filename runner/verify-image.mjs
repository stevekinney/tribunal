import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const requiredCommands = ['git', 'node', 'bun'];
const missingCommands = requiredCommands.filter((command) => {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status !== 0;
});

if (missingCommands.length > 0) {
  console.error(`Reviewer image is missing required commands: ${missingCommands.join(', ')}`);
  process.exit(1);
}

if (!existsSync(new URL('./verify-image.mjs', import.meta.url))) {
  console.error('Reviewer image runner directory is not readable.');
  process.exit(1);
}

const importChecks = [
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

for (const check of importChecks) {
  try {
    const importedModule = await import(check.packageName);
    if (!check.verify(importedModule)) {
      console.error(`Reviewer image runtime package failed shape check: ${check.packageName}`);
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Reviewer image cannot import ${check.packageName}: ${message}`);
    process.exit(1);
  }
}

console.log('Reviewer image self-check passed.');
