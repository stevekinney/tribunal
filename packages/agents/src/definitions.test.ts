import { describe, expect, it } from 'vitest';
import type { AgentSpec } from '@tribunal/review-core/types';
import { READ_ONLY_AGENT_TOOLS, TRIBUNAL_READ_ONLY_TOOLS, toAgentDefinition } from './definitions';

const agentSpec: AgentSpec = {
  id: 'agent_1',
  userId: 1,
  slug: 'security-reviewer',
  description: 'Find security issues',
  body: 'Review the diff for security issues.',
  model: 'inherit',
  effort: 'xhigh',
  enabled: true,
};

describe('agent definitions', () => {
  it('maps a stored agent spec to a read-only Claude Agent SDK definition', () => {
    const mapped = toAgentDefinition(agentSpec, 'sonnet');

    expect(mapped.key).toBe('security-reviewer');
    expect(mapped.definition).toMatchObject({
      description: agentSpec.description,
      prompt: agentSpec.body,
      model: 'sonnet',
      effort: 'high',
    });
    expect(mapped.definition.tools).toEqual([
      ...READ_ONLY_AGENT_TOOLS,
      ...TRIBUNAL_READ_ONLY_TOOLS,
    ]);
    expect(mapped.definition.tools).not.toContain('Write');
    expect(mapped.definition.tools).not.toContain('Edit');
    expect(mapped.definition.tools).not.toContain('Bash');
  });

  it('maps inherit, xhigh fallback, xhigh-capable fable, and haiku effort rules', () => {
    expect(toAgentDefinition({ ...agentSpec, model: 'inherit' }, 'opus').effectiveModel).toBe(
      'opus',
    );
    expect(
      toAgentDefinition({ ...agentSpec, model: 'sonnet', effort: 'xhigh' }, 'opus').effectiveEffort,
    ).toBe('high');
    expect(
      toAgentDefinition({ ...agentSpec, model: 'fable', effort: 'xhigh' }, 'opus').effectiveEffort,
    ).toBe('xhigh');
    expect(
      toAgentDefinition({ ...agentSpec, model: 'haiku', effort: 'max' }, 'opus').effectiveEffort,
    ).toBeNull();
    expect(
      toAgentDefinition({ ...agentSpec, model: 'sonnet', effort: undefined }, 'opus')
        .effectiveEffort,
    ).toBeNull();
    expect(
      toAgentDefinition({ ...agentSpec, model: 'claude-fable-reviewer', effort: 'xhigh' }, 'opus')
        .effectiveEffort,
    ).toBe('xhigh');
  });
});
