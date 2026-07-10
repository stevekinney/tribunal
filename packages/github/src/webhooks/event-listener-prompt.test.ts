import { describe, expect, it } from 'vitest';
import {
  EVENT_LISTENER_PAYLOAD_EXCERPT_MAX_CHARS,
  buildEventListenerPrompt,
} from './event-listener-prompt.js';

function baseInput() {
  return {
    agent: { body: 'You are a careful reviewer.' },
    listenerInstructionsMarkdown: '# Triage\nLook for duplicates.',
    repository: { owner: 'lostgradient', name: 'tribunal', defaultBranch: 'main' },
    event: {
      eventType: 'issues',
      action: 'opened' as string | null,
      ref: null as string | null,
      prNumber: null as number | null,
      issueNumber: 42 as number | null,
      senderLogin: 'octocat' as string | null,
      commitSha: null as string | null,
      payload: '{"issue":{"number":42}}',
    },
  };
}

describe('buildEventListenerPrompt', () => {
  it('includes the agent base prompt, listener instructions, webhook metadata, and repository context in order', () => {
    const prompt = buildEventListenerPrompt(baseInput());

    const agentIndex = prompt.indexOf('You are a careful reviewer.');
    const instructionsIndex = prompt.indexOf('Look for duplicates.');
    const metadataIndex = prompt.indexOf('Event type: issues');
    const repositoryIndex = prompt.indexOf('Repository: lostgradient/tribunal');

    expect(agentIndex).toBeGreaterThanOrEqual(0);
    expect(instructionsIndex).toBeGreaterThan(agentIndex);
    expect(metadataIndex).toBeGreaterThan(instructionsIndex);
    expect(repositoryIndex).toBeGreaterThan(metadataIndex);
  });

  it('includes normalized metadata fields that are present, and omits null ones', () => {
    const prompt = buildEventListenerPrompt(baseInput());

    expect(prompt).toContain('Action: opened');
    expect(prompt).toContain('Issue number: 42');
    expect(prompt).toContain('Sender: octocat');
    expect(prompt).not.toContain('Ref:');
    expect(prompt).not.toContain('Pull request number:');
    expect(prompt).not.toContain('Commit SHA:');
  });

  it('omits the listener instructions section when there are no instructions', () => {
    const input = baseInput();
    input.listenerInstructionsMarkdown = '   ';
    const prompt = buildEventListenerPrompt(input);
    expect(prompt).not.toContain('## Event listener instructions');
  });

  it('includes the bounded payload excerpt as JSON', () => {
    const prompt = buildEventListenerPrompt(baseInput());
    expect(prompt).toContain('### Payload excerpt');
    expect(prompt).toContain('"issue":{"number":42}');
  });

  it('truncates a payload larger than the bound', () => {
    const input = baseInput();
    input.event.payload = 'x'.repeat(EVENT_LISTENER_PAYLOAD_EXCERPT_MAX_CHARS + 500);
    const prompt = buildEventListenerPrompt(input);
    expect(prompt).toContain('(truncated,');
    expect(prompt.length).toBeLessThan(input.event.payload.length + 2000);
  });

  it('omits the default branch line when null', () => {
    const input = baseInput();
    input.repository.defaultBranch = null as unknown as string;
    const prompt = buildEventListenerPrompt(input);
    expect(prompt).not.toContain('Default branch:');
  });
});
