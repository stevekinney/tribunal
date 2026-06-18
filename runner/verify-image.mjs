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

console.log('Reviewer image self-check passed.');
