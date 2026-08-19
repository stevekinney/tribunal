import { describe, expect, it } from 'vitest';
import {
  MAX_DAILY_COST_CAP_USD,
  SPECIALIST_MAX_BUDGET_USD,
  TRIAGE_MAX_BUDGET_USD,
  VERIFIER_MAX_BUDGET_USD,
} from './review-cost-limits';

describe('review cost limits', () => {
  it('defines the fixed per-invocation and per-user daily circuit breakers', () => {
    expect(TRIAGE_MAX_BUDGET_USD).toBe(0.05);
    expect(SPECIALIST_MAX_BUDGET_USD).toBe(1);
    expect(VERIFIER_MAX_BUDGET_USD).toBe(0.05);
    expect(MAX_DAILY_COST_CAP_USD).toBe(25);
  });
});
