import type { AgentModel, AgentSpec, Effort } from '@tribunal/review-core/types';

export const READ_ONLY_AGENT_TOOLS = ['Read', 'Grep', 'Glob'] as const;

export const TRIBUNAL_READ_ONLY_TOOLS = [
  'mcp__tribunal__get_changed_files',
  'mcp__tribunal__read_base_file',
  'mcp__tribunal__get_pr_context',
  'mcp__tribunal__get_review_guidelines',
  'mcp__tribunal__record_finding',
] as const;

export const ALLOWED_AGENT_TOOLS = [...READ_ONLY_AGENT_TOOLS, ...TRIBUNAL_READ_ONLY_TOOLS] as const;

export type AllowedAgentTool = (typeof ALLOWED_AGENT_TOOLS)[number];

export type AgentDefinition = {
  description: string;
  prompt: string;
  tools: AllowedAgentTool[];
  model: string;
  effort?: Effort;
};

export type MappedAgentDefinition = {
  key: string;
  definition: AgentDefinition;
  effectiveModel: string;
  effectiveEffort: Effort | null;
};

/** Maps stored Tribunal agent settings to a read-only Claude Agent SDK agent definition. */
export function toAgentDefinition(
  agentSpec: AgentSpec,
  defaultModel: Exclude<AgentModel, 'inherit'>,
): MappedAgentDefinition {
  const effectiveModel = agentSpec.model === 'inherit' ? defaultModel : agentSpec.model;
  const effectiveEffort = resolveEffort(effectiveModel, agentSpec.effort);
  const definition: AgentDefinition = {
    description: agentSpec.description,
    prompt: agentSpec.body,
    tools: [...ALLOWED_AGENT_TOOLS],
    model: effectiveModel,
  };

  if (effectiveEffort !== null) {
    definition.effort = effectiveEffort;
  }

  return {
    key: agentSpec.slug,
    definition,
    effectiveModel,
    effectiveEffort,
  };
}

function resolveEffort(model: string, effort: Effort | undefined): Effort | null {
  if (model === 'haiku') return null;
  if (effort === undefined) return null;
  if (effort === 'xhigh' && !supportsExtraHighEffort(model)) return 'high';
  return effort;
}

function supportsExtraHighEffort(model: string): boolean {
  return model === 'fable' || model.includes('fable');
}
