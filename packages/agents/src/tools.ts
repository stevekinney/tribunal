import type { ChangedFile, DiffContext, Finding } from '@tribunal/review-core/types';
import { validateFinding } from './findings';

export type ReviewTool<TInput, TOutput> = {
  name: string;
  description: string;
  readOnlyHint: true;
  execute(input: TInput): TOutput;
};

export type TribunalReviewTools = {
  get_changed_files: ReviewTool<
    Record<string, never>,
    { changedFiles: ChangedFile[]; changedSinceLast: ChangedFile[] }
  >;
  read_base_file: ReviewTool<{ path: string }, { path: string; contents: string | null }>;
  get_pr_context: ReviewTool<
    Record<string, never>,
    { pullRequest: DiffContext['pr']; headSha: string; baseSha: string }
  >;
  get_review_guidelines: ReviewTool<Record<string, never>, { guidelines: string }>;
  record_finding: ReviewTool<{ finding: unknown }, { ok: boolean; reason?: string }> & {
    collectedFindings: Finding[];
  };
};

export type ReviewToolContext = {
  diffContext: DiffContext;
  guidelines: string;
  readBaseFile?: (path: string) => string | null;
};

/** Creates pure Tribunal review tool definitions with read-only metadata for the Agent SDK MCP server. */
export function createTribunalReviewTools(context: ReviewToolContext): TribunalReviewTools {
  const collectedFindings: Finding[] = [];

  return {
    get_changed_files: {
      name: 'get_changed_files',
      description: 'Return the changed files for the pull request under review.',
      readOnlyHint: true,
      execute: () => ({
        changedFiles: context.diffContext.changedFiles,
        changedSinceLast: context.diffContext.changedSinceLast ?? [],
      }),
    },
    read_base_file: {
      name: 'read_base_file',
      description: 'Read a file at the pull request base revision through the Tribunal boundary.',
      readOnlyHint: true,
      execute: ({ path }) => ({ path, contents: context.readBaseFile?.(path) ?? null }),
    },
    get_pr_context: {
      name: 'get_pr_context',
      description: 'Return pull request metadata for the review.',
      readOnlyHint: true,
      execute: () => ({
        pullRequest: context.diffContext.pr,
        headSha: context.diffContext.headSha,
        baseSha: context.diffContext.baseSha,
      }),
    },
    get_review_guidelines: {
      name: 'get_review_guidelines',
      description: 'Return review guidelines for the repository.',
      readOnlyHint: true,
      execute: () => ({ guidelines: context.guidelines }),
    },
    record_finding: {
      name: 'record_finding',
      description: 'Validate and collect one structured review finding.',
      readOnlyHint: true,
      collectedFindings,
      execute: ({ finding }) => {
        const validation = validateFinding(finding, context.diffContext);
        if (!validation.ok) return { ok: false, reason: validation.reason };

        collectedFindings.push(validation.finding);
        return { ok: true };
      },
    },
  };
}
