import type { AgentResult } from '@tribunal/review-core/types';

/**
 * Fraction of an agent's total input tokens that were served from the Agent
 * SDK's prompt cache (`cache_read_input_tokens` / total input). Exposed so the
 * run inspector and cost ledger can verify the shared-prefix cache discipline
 * in `buildReviewPrompt` is actually paying off — the target is >80% for every
 * agent after the first in a run.
 */
export function computeCacheHitRate(usage: AgentResult['usage']): number {
  const totalInputTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  if (totalInputTokens <= 0) return 0;
  return usage.cacheReadTokens / totalInputTokens;
}
