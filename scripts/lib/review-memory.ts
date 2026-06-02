import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH = 'documentation/learnings';

const REVIEW_LEARNING_FILE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*(?:\.md)?$/;

function hasMeaningfulLearningContent(content: string): boolean {
  if (!content) return false;

  return content
    .split('\n')
    .some((line) => line.trim() !== '' && !line.trimStart().startsWith('<!--'));
}

/**
 * Load review learnings from per-entry learning files.
 *
 * Files must follow `YYYY-MM-DD-kebab-name` with an optional `.md` suffix.
 */
export function loadReviewLearningsFromReferenceFiles(cwd?: string): string | null {
  const reviewLearningsDirectoryPath = resolve(
    cwd ?? process.cwd(),
    REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH,
  );

  if (!existsSync(reviewLearningsDirectoryPath)) return null;

  const learningFileNames = readdirSync(reviewLearningsDirectoryPath, {
    withFileTypes: true,
  })
    .filter(
      (directoryEntry) =>
        directoryEntry.isFile() && REVIEW_LEARNING_FILE_NAME_PATTERN.test(directoryEntry.name),
    )
    .map((directoryEntry) => directoryEntry.name)
    .sort((leftFileName, rightFileName) => leftFileName.localeCompare(rightFileName));

  const learningSections: string[] = [];

  for (const learningFileName of learningFileNames) {
    const learningFilePath = resolve(reviewLearningsDirectoryPath, learningFileName);
    const learningContent = readFileSync(learningFilePath, 'utf-8').trim();

    if (!hasMeaningfulLearningContent(learningContent)) continue;

    learningSections.push(`## ${learningFileName}\n${learningContent}`);
  }

  if (learningSections.length === 0) return null;
  return learningSections.join('\n\n');
}
