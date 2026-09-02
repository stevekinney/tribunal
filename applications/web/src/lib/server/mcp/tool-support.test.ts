import { describe, expect, it } from 'vitest';
import {
  describeReadError,
  readErrorResponse,
  unresolvedSubjectError,
  type McpReadError,
} from './tool-support';

const everyReadError: McpReadError[] = [
  'no_github_token',
  'github_unavailable',
  'repository_not_found',
  'github_unreachable',
  'pull_request_not_found',
  'review_run_not_found',
  'review_finding_not_found',
  'repository_selector_missing',
  'repository_selector_conflict',
  'repository_name_ambiguous',
  'github_rate_limited',
  'github_read_failed',
];

describe('describeReadError', () => {
  it.each(everyReadError)('describes %s in caller-facing terms', (error) => {
    expect.assertions(2);
    const message = describeReadError(error);

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(error);
  });

  it('gives every failure its own message so none is silently collapsed', () => {
    expect.assertions(1);
    const messages = everyReadError.map(describeReadError);

    expect(new Set(messages).size).toBe(everyReadError.length);
  });

  it('does not distinguish an inaccessible repository from a missing one', () => {
    expect.assertions(1);

    expect(describeReadError('repository_not_found')).toBe(
      'No repository matching that id, or that owner and name, is connected to your Tribunal account.',
    );
  });

  it('names neither selector form when a repository does not resolve', () => {
    expect.assertions(2);
    const message = describeReadError('repository_not_found');

    // A caller that sent owner and name must not be told its id was wrong;
    // that invites a model to invent one.
    expect(message).toContain('owner and name');
    expect(message).toContain('id');
  });
});

describe('readErrorResponse', () => {
  it('returns a tool error carrying the description', () => {
    expect.assertions(2);
    const response = readErrorResponse('pull_request_not_found');

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe(describeReadError('pull_request_not_found'));
  });
});

describe('unresolvedSubjectError', () => {
  it('reports an unbound token without echoing the subject back', () => {
    expect.assertions(2);
    const response = unresolvedSubjectError();

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/not bound to a Tribunal account/);
  });
});
