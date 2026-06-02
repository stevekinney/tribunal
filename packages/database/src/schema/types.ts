// ============================================================================
// JSON TYPES (for typed jsonb columns)
// ============================================================================

/** Commit metadata for workflow revert guidance */
export interface CommitInfo {
  sha: string;
  shortSha: string;
  url: string;
  message: string;
  createdAt: string;
}

/** Factors used to compute confidence score for comment resolution */
export interface ConfidenceFactors {
  fileChanged: boolean;
  lineOverlap: boolean;
}

/** Result of evaluating whether a review comment was addressed */
export interface CommentResolutionResult {
  commentId: string;
  commentNodeId: string;
  threadId: string | null;
  path: string;
  line: number | null;
  confidence: number;
  confidenceFactors: ConfidenceFactors;
  resolution: 'resolved' | 'likely_addressed' | 'skipped';
  rationale: string;
  error?: string;
  wasAlreadyResolved?: boolean;
}

/** Aggregated resolution results for persistence */
export interface ResolutionArtifact {
  comments: CommentResolutionResult[];
  summary: {
    resolved: number;
    likelyAddressed: number;
    skipped: number;
    errors: number;
  };
  autoResolveEnabled: boolean;
  confidenceThreshold: number;
  commitSha: string;
  rateLimited?: boolean;
}

// Re-export WorkflowRunArtifacts type for schema typing
export type { WorkflowRunArtifacts } from './workflow-artifacts';
