import { describe, expect, it } from 'vitest';

import { extractTicketFromBranch } from './ticket-from-branch';

describe('extractTicketFromBranch', () => {
  it('extracts ticket fields from common branch names', () => {
    expect(extractTicketFromBranch('feature/TRIB-179-runner-coverage')).toEqual({
      found: true,
      ticketId: 'TRIB-179',
      teamKey: 'TRIB',
      ticketNumber: 179,
      branch: 'feature/TRIB-179-runner-coverage',
    });
  });

  it('accepts lowercase team keys without rewriting the original ticket id', () => {
    expect(extractTicketFromBranch('fix/trib-42')).toEqual({
      found: true,
      ticketId: 'trib-42',
      teamKey: 'trib',
      ticketNumber: 42,
      branch: 'fix/trib-42',
    });
  });

  it('returns a stable empty result when no ticket is present', () => {
    expect(extractTicketFromBranch('issue/179')).toEqual({
      found: false,
      ticketId: null,
      teamKey: null,
      ticketNumber: null,
      branch: 'issue/179',
    });
  });
});
