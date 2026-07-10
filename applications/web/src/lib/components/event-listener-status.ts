import type { EventListenerDisplayStatus } from '@tribunal/database/queries';

/** Every status this small vocabulary can render, including the webhook-page-only `received_only`. */
export type EventListenerRowStatus = 'received_only' | EventListenerDisplayStatus;

const LABELS: Record<EventListenerRowStatus, string> = {
  received_only: 'Received',
  matched: 'Matched',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const VARIANTS: Record<
  EventListenerRowStatus,
  'neutral' | 'info' | 'success' | 'danger' | 'warning'
> = {
  received_only: 'neutral',
  matched: 'neutral',
  queued: 'warning',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Visible label for a listener/delivery progress status. Shared by the repository events page and both webhook event pages. */
export function eventListenerStatusLabel(status: EventListenerRowStatus): string {
  return LABELS[status];
}

/** Badge variant for a listener/delivery progress status. Color is never the sole signal -- the label is always shown too. */
export function eventListenerStatusVariant(
  status: EventListenerRowStatus,
): 'neutral' | 'info' | 'success' | 'danger' | 'warning' {
  return VARIANTS[status];
}
