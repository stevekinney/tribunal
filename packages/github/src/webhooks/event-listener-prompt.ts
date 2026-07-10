/**
 * Builds the prompt an event listener's agent run receives. Explicit and
 * testable: four clearly-separated sections concatenated in a fixed order,
 * no hidden state.
 */
import type { Agent, Repository, WebhookEvent } from '@tribunal/database/schema';

/** Payload excerpts are bounded so one large webhook body cannot blow the prompt budget. */
export const EVENT_LISTENER_PAYLOAD_EXCERPT_MAX_CHARS = 4000;

export interface BuildEventListenerPromptInput {
  agent: Pick<Agent, 'body'>;
  listenerInstructionsMarkdown: string;
  repository: Pick<Repository, 'owner' | 'name' | 'defaultBranch'>;
  event: Pick<
    WebhookEvent,
    | 'eventType'
    | 'action'
    | 'ref'
    | 'prNumber'
    | 'issueNumber'
    | 'senderLogin'
    | 'commitSha'
    | 'payload'
  >;
}

function truncatePayload(payload: string): string {
  if (payload.length <= EVENT_LISTENER_PAYLOAD_EXCERPT_MAX_CHARS) return payload;
  return `${payload.slice(0, EVENT_LISTENER_PAYLOAD_EXCERPT_MAX_CHARS)}\n… (truncated, ${payload.length} total characters)`;
}

/**
 * Assemble the four required sections in order: agent base prompt, listener
 * instructions, normalized webhook metadata + bounded payload excerpt, and
 * repository context.
 */
export function buildEventListenerPrompt(input: BuildEventListenerPromptInput): string {
  const { agent, listenerInstructionsMarkdown, repository, event } = input;

  const metadataLines = [
    `Event type: ${event.eventType}`,
    event.action !== null ? `Action: ${event.action}` : null,
    event.ref !== null ? `Ref: ${event.ref}` : null,
    event.prNumber !== null ? `Pull request number: ${event.prNumber}` : null,
    event.issueNumber !== null ? `Issue number: ${event.issueNumber}` : null,
    event.senderLogin !== null ? `Sender: ${event.senderLogin}` : null,
    event.commitSha !== null ? `Commit SHA: ${event.commitSha}` : null,
  ].filter((line): line is string => line !== null);

  const sections = [
    agent.body,
    listenerInstructionsMarkdown.trim().length > 0
      ? `## Event listener instructions\n\n${listenerInstructionsMarkdown}`
      : null,
    [
      '## Webhook context',
      '',
      metadataLines.join('\n'),
      '',
      '### Payload excerpt',
      '',
      '```json',
      truncatePayload(event.payload),
      '```',
    ].join('\n'),
    [
      '## Repository context',
      '',
      `Repository: ${repository.owner}/${repository.name}`,
      repository.defaultBranch !== null ? `Default branch: ${repository.defaultBranch}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
  ].filter((section): section is string => section !== null);

  return sections.join('\n\n');
}
