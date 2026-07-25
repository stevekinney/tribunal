import type { ActionItemSourceType } from '@tribunal/database/schema';

export type ActionItemInput = {
  stableKey: string;
  firstSeenHeadSha?: string | null;
};

export type ActionItemSourceInput = {
  sourceType: ActionItemSourceType;
  sourceIdentifier: string;
};
