import { describe, expect, it } from 'vitest';
import { serializeEventListenerFilters } from '@tribunal/database/queries';
import { eventListenerMatchesEvent } from './event-listener-matching.js';

function baseEvent() {
  return {
    eventType: 'issues',
    action: 'opened' as string | null,
    ref: null as string | null,
    prNumber: null as number | null,
    issueNumber: 7 as number | null,
    senderLogin: 'octocat' as string | null,
  };
}

function baseListener(overrides: Partial<{ action: string | null; filtersJson: string }> = {}) {
  return {
    eventType: 'issues',
    action: overrides.action ?? null,
    filtersJson: overrides.filtersJson ?? '{}',
  };
}

describe('eventListenerMatchesEvent', () => {
  it('does not match a different event type', () => {
    expect(eventListenerMatchesEvent({ ...baseListener(), eventType: 'push' }, baseEvent())).toBe(
      false,
    );
  });

  it('matches when the listener has no action filter', () => {
    expect(eventListenerMatchesEvent(baseListener({ action: null }), baseEvent())).toBe(true);
  });

  it('matches only the exact action when the listener specifies one', () => {
    expect(eventListenerMatchesEvent(baseListener({ action: 'opened' }), baseEvent())).toBe(true);
    expect(eventListenerMatchesEvent(baseListener({ action: 'closed' }), baseEvent())).toBe(false);
  });

  it('matches on a named filter (issueNumber)', () => {
    const filtersJson = serializeEventListenerFilters({ issueNumber: 7 });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(true);

    const wrongFilters = serializeEventListenerFilters({ issueNumber: 8 });
    expect(
      eventListenerMatchesEvent(baseListener({ filtersJson: wrongFilters }), baseEvent()),
    ).toBe(false);
  });

  it('matches on senderLogin', () => {
    const filtersJson = serializeEventListenerFilters({ senderLogin: 'octocat' });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(true);

    const wrongFilters = serializeEventListenerFilters({ senderLogin: 'someone-else' });
    expect(
      eventListenerMatchesEvent(baseListener({ filtersJson: wrongFilters }), baseEvent()),
    ).toBe(false);
  });

  it('requires every declared filter to match (AND semantics)', () => {
    const filtersJson = serializeEventListenerFilters({ issueNumber: 7, senderLogin: 'nope' });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(false);
  });

  it('a listener with an unmatchable ref filter does not match an event with a null ref', () => {
    const filtersJson = serializeEventListenerFilters({ ref: 'refs/heads/main' });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(false);
  });

  it('fails closed (does not match) when the stored filters_json is malformed', () => {
    expect(eventListenerMatchesEvent(baseListener({ filtersJson: 'not json' }), baseEvent())).toBe(
      false,
    );
  });
});
