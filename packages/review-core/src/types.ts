export type AgentModel = 'sonnet' | 'opus' | 'haiku' | 'fable' | 'inherit' | (string & {});

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Pipeline stage a sandbox run belongs to. Persisted on `agent_run.role`. */
export type AgentRunRole = 'triage' | 'specialist' | 'verifier';

export interface AgentSpec {
  id: string;
  userId: number;
  slug: string;
  description: string;
  body: string;
  model: AgentModel;
  effort?: Effort;
  enabled: boolean;
  /** Per-agent circuit breaker under the daily cap; plumbed to the SDK's `maxBudgetUsd` query option. */
  maxBudgetUsd?: number;
  /** Defaults to `specialist` when omitted. Selects the runner's prompt and structured-output schema. */
  role?: AgentRunRole;
  /** Set only for `role: 'verifier'` runs: the candidate finding under adversarial review. */
  findingToVerify?: Finding;
  /** Set only for `role: 'triage'` runs: the specialist roster available for this review run. */
  availableAgentSlugs?: string[];
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
  /**
   * Fingerprints of near-duplicate findings absorbed into this one by
   * cross-agent dedup (`mergeNearDuplicateFindings`). Lets Phase 3's
   * carried-forward dedup match a re-reported finding against either this
   * finding's own fingerprint or any fingerprint it absorbed.
   */
  mergedFingerprints?: string[];
}

export interface TriageDecision {
  skip: boolean;
  reason: string;
  riskFlags: string[];
}

export interface VerificationDecision {
  verified: boolean;
  note: string;
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
  stopped?: 'superseded' | 'pr_closed' | 'budget' | 'timeout';
  error?: string;
  /** Present only for `role: 'triage'` runs. */
  triage?: TriageDecision;
  /** Present only for `role: 'verifier'` runs. */
  verification?: VerificationDecision;
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
  kind:
    | 'session_start'
    | 'tool_pre'
    | 'tool_post'
    | 'notification'
    | 'message'
    | 'usage'
    | 'stop'
    | 'error';
  tool?: string;
  detail?: Record<string, unknown>;
  at: string;
}
