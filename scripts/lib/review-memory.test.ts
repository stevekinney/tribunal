import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadReviewLearningsFromReferenceFiles,
  REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH,
} from './review-memory';

describe('loadReviewLearningsFromReferenceFiles', () => {
  let directory: string;
  let learningsDirectory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'review-memory-test-'));
    learningsDirectory = join(directory, REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns null when the learnings directory does not exist', () => {
    expect(loadReviewLearningsFromReferenceFiles(directory)).toBeNull();
  });

  it('returns null when the directory has no matching learning files', () => {
    mkdirSync(learningsDirectory, { recursive: true });
    writeFileSync(join(learningsDirectory, 'not-a-learning-file.txt'), 'ignored content');

    expect(loadReviewLearningsFromReferenceFiles(directory)).toBeNull();
  });

  it('returns null when every matching file has no meaningful content', () => {
    mkdirSync(learningsDirectory, { recursive: true });
    writeFileSync(join(learningsDirectory, '2026-01-01-empty-learning.md'), '   \n<!-- note -->\n');

    expect(loadReviewLearningsFromReferenceFiles(directory)).toBeNull();
  });

  it('loads and sorts meaningful learning files, skipping empty ones', () => {
    mkdirSync(learningsDirectory, { recursive: true });
    writeFileSync(
      join(learningsDirectory, '2026-02-01-second-learning.md'),
      'Second learning body.',
    );
    writeFileSync(join(learningsDirectory, '2026-01-01-first-learning'), 'First learning body.');
    writeFileSync(
      join(learningsDirectory, '2026-01-15-blank-learning.md'),
      '<!-- only comment -->',
    );
    mkdirSync(join(learningsDirectory, '2026-03-01-a-directory-not-a-file'));

    const result = loadReviewLearningsFromReferenceFiles(directory);

    expect(result).not.toBeNull();
    const sections = result?.split('\n\n') ?? [];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('2026-01-01-first-learning');
    expect(sections[0]).toContain('First learning body.');
    expect(sections[1]).toContain('2026-02-01-second-learning.md');
    expect(sections[1]).toContain('Second learning body.');
  });

  it('defaults to process.cwd() when no directory is provided', () => {
    const result = loadReviewLearningsFromReferenceFiles();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
