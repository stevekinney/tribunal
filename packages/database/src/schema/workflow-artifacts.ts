/**
 * Type definitions for workflow run artifacts.
 *
 * These types define the structure for CI failure snapshots,
 * agent plans, and validation evidence captured during workflow execution.
 */

export type CheckRunAnnotation = {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: 'notice' | 'warning' | 'failure';
  message: string;
  title: string | null;
};

export type FailingCheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  summary: string | null;
  annotations: CheckRunAnnotation[];
  htmlUrl: string | null;
  fetchError?: string;
};

export type CIFailureSnapshot = {
  headSha: string;
  fetchedAt: string;
  failingChecks: FailingCheckRun[];
  totalFailingCount: number;
  truncated: boolean;
};

export type AgentPlan = {
  text: string;
  capturedAt: string;
  extractionMethod: 'markdown_header' | 'first_response' | 'none';
  truncated?: boolean;
};

export type ValidationEvidence = {
  attempt: number;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  executedAt: string;
  durationMs: number;
  truncated: boolean;
  timedOut?: boolean;
};

export type WorkflowContextSnapshot = {
  version: '1.0';
  capturedAt: string;
  workspace: {
    id: number;
    handle: string | null;
  };
  repository: {
    id: number;
    owner: string;
    name: string;
    defaultBranch: string;
  };
  goal: string;
  prNumber?: number;
  headSha?: string;
  attachments?: Array<{
    type: string;
    content: string;
  }>;
};

export type AnalysisReport = {
  capturedAt: string;
  content: string;
  truncated: boolean;
  tokensUsed?: number;
};

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type TaskItem = {
  commentId: string;
  task: string;
  status: TaskStatus;
  fileTargets?: string[];
  notes?: string;
};

export type TaskListArtifact = {
  capturedAt: string;
  headSha: string;
  tasks: TaskItem[];
  commentsProcessed: number;
  commentsSkipped: number;
};

export type WorkflowRunArtifacts = {
  ciSnapshot?: CIFailureSnapshot;
  plan?: AgentPlan;
  validationRuns?: ValidationEvidence[];
  contextSnapshot?: WorkflowContextSnapshot;
  analysisReport?: AnalysisReport;
  taskList?: TaskListArtifact;
};
