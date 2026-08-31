import { join } from 'node:path';

export function buildPrecommitVitestInvocation(repositoryRoot: string): {
  command: string[];
  workingDirectory: string;
} {
  return {
    workingDirectory: join(repositoryRoot, 'applications/web'),
    command: [
      'vitest',
      'run',
      '--reporter=verbose',
      '--changed',
      '--bail',
      '1',
      '--project',
      'server',
      '--project',
      'client',
    ],
  };
}
