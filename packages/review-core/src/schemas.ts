import { z } from 'zod';

export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

export const agentModelSchema = z.union([
  z.enum(['sonnet', 'opus', 'haiku', 'fable', 'inherit']),
  z.string().regex(/^claude-[a-z0-9-]+$/),
]);

export const findingSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  severity: z.enum(['info', 'warning', 'error']),
  title: z.string().min(1),
  body: z.string().min(1),
  suggestion: z.string().optional(),
  mergedFingerprints: z.array(z.string()).optional(),
});

export const agentRunRoleSchema = z.enum(['triage', 'specialist', 'verifier']);

export const agentSpecSchema = z.object({
  id: z.string().min(1),
  userId: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1),
  body: z.string().min(1),
  model: agentModelSchema,
  effort: effortSchema.optional(),
  enabled: z.boolean(),
  maxBudgetUsd: z.number().positive().optional(),
  role: agentRunRoleSchema.optional(),
  findingToVerify: findingSchema.optional(),
  availableAgentSlugs: z.array(z.string()).optional(),
});

export const triageDecisionSchema = z.object({
  skip: z.boolean(),
  reason: z.string(),
  riskFlags: z.array(z.string()),
});

export const verificationDecisionSchema = z.object({
  verified: z.boolean(),
  note: z.string(),
});

export const agentResultSchema = z.object({
  agentSlug: z.string().min(1),
  findings: z.array(findingSchema),
  modelUsed: z.string().min(1),
  effortUsed: effortSchema.nullable(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
  }),
  costEstimateUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  stopped: z.enum(['superseded', 'pr_closed', 'budget', 'timeout']).optional(),
  error: z.string().optional(),
  triage: triageDecisionSchema.optional(),
  verification: verificationDecisionSchema.optional(),
});

export const reviewIntentKindSchema = z.enum(['start', 'commit_pushed', 'pr_closed']);
