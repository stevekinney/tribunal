export type AgentModel = 'sonnet' | 'opus' | 'haiku' | 'fable' | 'inherit' | (string & {});

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentSpec {
  id: string;
  userId: number;
  slug: string;
  description: string;
  body: string;
  model: AgentModel;
  effort?: Effort;
  enabled: boolean;
}

export interface Finding {
  path: string;
  startLine: number | null;
  endLine: number | null;
  side: 'LEFT' | 'RIGHT';
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  suggestion?: string;
}

export interface AgentResult {
  agentSlug: string;
  findings: Finding[];
  modelUsed: string;
  effortUsed: Effort | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  costEstimateUsd: number;
  durationMs: number;
  stopped?: 'superseded' | 'pr_closed' | 'budget' | 'timeout' | 'operator';
  error?: string;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  patch?: string;
  commentableLines: { side: 'LEFT' | 'RIGHT'; line: number }[];
}

export interface DiffContext {
  headSha: string;
  baseSha: string;
  prevHeadSha?: string;
  changedFiles: ChangedFile[];
  changedSinceLast?: ChangedFile[];
  pr: { number: number; title: string; body: string; labels: string[]; author: string };
}

export interface AgentEvent {
  agentRunId: string;
  seq: number;
  kind: 'session_start' | 'tool_pre' | 'tool_post' | 'notification' | 'message' | 'stop' | 'error';
  tool?: string;
  detail?: Record<string, unknown>;
  at: string;
}
