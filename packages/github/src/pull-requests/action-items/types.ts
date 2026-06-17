import type { ActionItemStatus, ActionItemSourceType } from '@tribunal/database/schema';

export type ActionItemInput = {
  stableKey: string;
  subject: string;
  description?: string | null;
  status: ActionItemStatus;
  firstSeenHeadSha?: string | null;
};

export type ActionItemSourceInput = {
  sourceType: ActionItemSourceType;
  sourceIdentifier: string;
  sourceUrl?: string | null;
};
