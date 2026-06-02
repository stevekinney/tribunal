/**
 * Lists review learnings from per-entry markdown files.
 *
 * Used by skill dynamic injection (`!`command``) to provide current learning
 * context without relying on a single shared file.
 */

import { resolve } from 'node:path';
import { loadReviewLearningsFromReferenceFiles } from '../lib/review-memory';

const repositoryRoot = resolve(import.meta.dir, '..', '..');

function main(): void {
  const reviewLearnings = loadReviewLearningsFromReferenceFiles(repositoryRoot);
  if (!reviewLearnings) {
    console.log('No review learnings recorded yet.');
    return;
  }

  console.log(reviewLearnings);
}

main();
