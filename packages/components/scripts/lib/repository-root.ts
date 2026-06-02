import { resolve } from 'node:path';

/** Resolve the repository root relative to this script's location (`packages/components/scripts/lib/`). */
export function resolveRepositoryRoot(): string {
  return resolve(import.meta.dir, '..', '..', '..', '..');
}
