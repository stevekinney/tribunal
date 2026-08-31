import { describe, expect, it } from 'vitest';
import { buildPrecommitVitestInvocation } from './precommit-tests';

describe('buildPrecommitVitestInvocation', () => {
  it('runs from the web workspace so its SvelteKit and Vite configuration resolve', () => {
    expect(buildPrecommitVitestInvocation('/repository')).toEqual({
      workingDirectory: '/repository/applications/web',
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
    });
  });
});
