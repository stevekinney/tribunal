import { describe, expect, it } from 'vitest';
import { eventListenerStatusLabel, eventListenerStatusVariant } from './event-listener-status';
import type { EventListenerRowStatus } from './event-listener-status';

const STATUSES: EventListenerRowStatus[] = [
  'received_only',
  'matched',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

describe('eventListenerStatusLabel', () => {
  it('returns the expected label for every status in the vocabulary', () => {
    expect(STATUSES.map(eventListenerStatusLabel)).toEqual([
      'Received',
      'Matched',
      'Queued',
      'Running',
      'Succeeded',
      'Failed',
      'Cancelled',
    ]);
  });
});

describe('eventListenerStatusVariant', () => {
  it('returns the expected badge variant for every status in the vocabulary', () => {
    expect(STATUSES.map(eventListenerStatusVariant)).toEqual([
      'neutral',
      'neutral',
      'warning',
      'info',
      'success',
      'danger',
      'neutral',
    ]);
  });
});
