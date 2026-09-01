import { existsSync } from 'node:fs';
import { installGitHooks } from './lib/install-git-hooks';

if (!existsSync('.git')) {
  process.exit(0);
}

process.exit(installGitHooks());
